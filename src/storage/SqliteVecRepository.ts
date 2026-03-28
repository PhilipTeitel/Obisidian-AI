import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import {
  noopOpenVectorStoreDatabase,
  openVectorStoreDatabaseLazy,
  type OpenVectorStoreDatabaseOptions,
  type SqliteDatabaseHandle
} from "./sqlite/openVectorStoreDatabase";
import type {
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingType,
  EmbeddingVector,
  HierarchicalStoreContract,
  NodeMatch,
  RuntimeBootstrapContext,
  RuntimeServiceLifecycle,
  SummaryRecord
} from "../types";

const HIERARCHICAL_STORE_KEY = "hierarchicalStore";
const logger = createRuntimeLogger("SqliteVecRepository");

export interface SqliteVecRepositoryDeps {
  plugin: RuntimeBootstrapContext["plugin"];
  pluginId: string;
  getVectorStoreAbsolutePath?: () => string;
  getSqliteWasmAssetDir?: () => string;
  openVectorStoreDatabase?: (
    options: OpenVectorStoreDatabaseOptions
  ) => Promise<SqliteDatabaseHandle>;
}

interface StoredEmbedding {
  nodeId: string;
  embeddingType: EmbeddingType;
  vector: EmbeddingVector;
}

interface ChildEntry {
  childId: string;
  sortOrder: number;
}

interface PersistedHierarchicalState {
  nodes: Array<[string, DocumentNode]>;
  children: Array<[string, ChildEntry[]]>;
  summaries: Array<[string, SummaryRecord]>;
  embeddings: StoredEmbedding[];
  tags: Array<[string, string[]]>;
  crossRefs: Array<[string, CrossReference[]]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const computeMagnitude = (values: number[]): number => {
  const mag = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return Number.isFinite(mag) ? mag : 0;
};

const cosineSimilarity = (a: EmbeddingVector, b: EmbeddingVector): number | null => {
  if (a.dimensions !== b.dimensions || a.values.length !== b.values.length) {
    return null;
  }
  const magA = computeMagnitude(a.values);
  const magB = computeMagnitude(b.values);
  if (magA === 0 || magB === 0) {
    return null;
  }
  const dot = a.values.reduce((sum, v, i) => sum + v * b.values[i], 0);
  return dot / (magA * magB);
};

export class SqliteVecRepository implements HierarchicalStoreContract, RuntimeServiceLifecycle {
  private readonly plugin: RuntimeBootstrapContext["plugin"];
  private readonly getVectorStoreAbsolutePath: () => string;
  private readonly getSqliteWasmAssetDir: () => string;
  private readonly openVectorStoreDatabase: (
    options: OpenVectorStoreDatabaseOptions
  ) => Promise<SqliteDatabaseHandle>;
  private nodes = new Map<string, DocumentNode>();
  private children = new Map<string, ChildEntry[]>();
  private summaries = new Map<string, SummaryRecord>();
  private embeddings: StoredEmbedding[] = [];
  private tags = new Map<string, string[]>();
  private crossRefs = new Map<string, CrossReference[]>();
  private initialized = false;
  private disposed = false;
  private vectorDbHandle: SqliteDatabaseHandle | null = null;
  private vectorDbOpenPromise: Promise<void> | null = null;

  public constructor(deps: SqliteVecRepositoryDeps) {
    this.plugin = deps.plugin;
    const canUseRealOpener =
      typeof deps.getVectorStoreAbsolutePath === "function" &&
      typeof deps.getSqliteWasmAssetDir === "function";
    this.getVectorStoreAbsolutePath = deps.getVectorStoreAbsolutePath ?? (() => "");
    this.getSqliteWasmAssetDir = deps.getSqliteWasmAssetDir ?? (() => "");
    this.openVectorStoreDatabase =
      deps.openVectorStoreDatabase ??
      (canUseRealOpener ? openVectorStoreDatabaseLazy : noopOpenVectorStoreDatabase);
  }

  public async init(): Promise<void> {
    this.ensureNotDisposed();
    const startedAt = Date.now();
    await this.loadState();
    this.initialized = true;
    logger.info({
      event: "storage.hierarchical.init.completed",
      message: "Hierarchical store initialized.",
      context: { nodeCount: this.nodes.size, elapsedMs: Date.now() - startedAt }
    });
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.vectorDbOpenPromise = null;
    if (this.vectorDbHandle) {
      try {
        await this.vectorDbHandle.close();
      } catch (error: unknown) {
        const normalized = normalizeRuntimeError(error, {
          operation: "SqliteVecRepository",
          phase: "vector_db_close"
        });
        logger.log({
          level: "error",
          event: "storage.hierarchical.vector_db.close_failed",
          message: "Failed to close vector store WASM database.",
          domain: normalized.domain,
          context: { operation: "SqliteVecRepository" },
          error: normalized
        });
      }
      this.vectorDbHandle = null;
    }
    logger.info({
      event: "storage.hierarchical.dispose.completed",
      message: "Hierarchical store disposed."
    });
  }

  private ensureNotDisposed(): void {
    if (!this.disposed) {
      return;
    }
    throw normalizeRuntimeError(new Error("Hierarchical store has been disposed."), {
      operation: "SqliteVecRepository",
      phase: "access_after_dispose",
      domainHint: "runtime"
    });
  }

  private async ensureVectorDbOpen(): Promise<void> {
    this.ensureNotDisposed();
    if (this.vectorDbHandle) {
      return;
    }
    if (!this.vectorDbOpenPromise) {
      this.vectorDbOpenPromise = (async () => {
        this.vectorDbHandle = await this.openVectorStoreDatabase({
          absoluteDbPath: this.getVectorStoreAbsolutePath(),
          sqliteWasmAssetDir: this.getSqliteWasmAssetDir()
        });
      })();
    }
    try {
      await this.vectorDbOpenPromise;
    } catch (error: unknown) {
      this.vectorDbHandle = null;
      throw error;
    } finally {
      this.vectorDbOpenPromise = null;
    }
  }

  public async upsertNodeTree(tree: DocumentTree): Promise<void> {
    await this.ensureVectorDbOpen();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const notePath = tree.root.notePath;

    this.removeByNotePath(notePath);

    for (const [nodeId, node] of tree.nodes) {
      this.nodes.set(nodeId, { ...node });
    }

    for (const [, node] of tree.nodes) {
      if (node.childIds.length > 0) {
        const entries: ChildEntry[] = node.childIds.map((childId, index) => ({
          childId,
          sortOrder: index
        }));
        this.children.set(node.nodeId, entries);
      }
    }

    await this.persistState();

    operationLogger.info({
      event: "storage.hierarchical.upsert_tree.completed",
      message: "Upserted node tree.",
      context: {
        notePath,
        nodeCount: tree.nodes.size,
        elapsedMs: Date.now() - startedAt
      }
    });
  }

  public async deleteByNotePath(notePath: string): Promise<void> {
    await this.ensureVectorDbOpen();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const removedCount = this.removeByNotePath(notePath);
    await this.persistState();

    operationLogger.info({
      event: "storage.hierarchical.delete_by_note_path.completed",
      message: "Deleted nodes by note path.",
      context: { notePath, removedNodeCount: removedCount, elapsedMs: Date.now() - startedAt }
    });
  }

  public async getNode(nodeId: string): Promise<DocumentNode | null> {
    await this.ensureVectorDbOpen();
    const node = this.nodes.get(nodeId);
    return node ? { ...node } : null;
  }

  public async getChildren(nodeId: string): Promise<DocumentNode[]> {
    await this.ensureVectorDbOpen();
    const entries = this.children.get(nodeId);
    if (!entries || entries.length === 0) {
      return [];
    }
    const sorted = [...entries].sort((a, b) => a.sortOrder - b.sortOrder);
    const result: DocumentNode[] = [];
    for (const entry of sorted) {
      const child = this.nodes.get(entry.childId);
      if (child) {
        result.push({ ...child });
      }
    }
    return result;
  }

  public async getAncestorChain(nodeId: string): Promise<DocumentNode[]> {
    await this.ensureVectorDbOpen();
    const chain: DocumentNode[] = [];
    const current = this.nodes.get(nodeId);
    if (!current) {
      return chain;
    }

    let parentId = current.parentId;
    while (parentId !== null) {
      const parent = this.nodes.get(parentId);
      if (!parent) {
        break;
      }
      chain.push({ ...parent });
      parentId = parent.parentId;
    }
    return chain;
  }

  public async getSiblings(nodeId: string): Promise<DocumentNode[]> {
    await this.ensureVectorDbOpen();
    const node = this.nodes.get(nodeId);
    if (!node) {
      return [];
    }
    if (node.parentId === null) {
      return [{ ...node }];
    }
    const parentEntries = this.children.get(node.parentId);
    if (!parentEntries) {
      return [{ ...node }];
    }
    const sorted = [...parentEntries].sort((a, b) => a.sortOrder - b.sortOrder);
    const result: DocumentNode[] = [];
    for (const entry of sorted) {
      const sibling = this.nodes.get(entry.childId);
      if (sibling) {
        result.push({ ...sibling });
      }
    }
    return result;
  }

  public async getNodesByNotePath(notePath: string): Promise<DocumentNode[]> {
    await this.ensureVectorDbOpen();
    const result: DocumentNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.notePath === notePath) {
        result.push({ ...node });
      }
    }
    return result;
  }

  public async searchSummaryEmbeddings(
    vector: EmbeddingVector,
    topK: number
  ): Promise<NodeMatch[]> {
    await this.ensureVectorDbOpen();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();

    const matches = this.searchEmbeddingsByType(vector, topK, "summary");

    operationLogger.debug({
      event: "storage.hierarchical.search_summary.completed",
      message: "Searched summary embeddings.",
      context: { topK, resultCount: matches.length, elapsedMs: Date.now() - startedAt }
    });
    return matches;
  }

  public async searchContentEmbeddings(
    vector: EmbeddingVector,
    topK: number,
    parentId?: string
  ): Promise<NodeMatch[]> {
    await this.ensureVectorDbOpen();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();

    const candidates = parentId
      ? this.embeddings.filter((e) => {
          if (e.embeddingType !== "content") return false;
          const node = this.nodes.get(e.nodeId);
          return node !== undefined && node.parentId === parentId;
        })
      : this.embeddings.filter((e) => e.embeddingType === "content");

    const scored: NodeMatch[] = [];
    for (const candidate of candidates) {
      const score = cosineSimilarity(vector, candidate.vector);
      if (score !== null) {
        scored.push({
          nodeId: candidate.nodeId,
          score,
          embeddingType: "content"
        });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.nodeId.localeCompare(b.nodeId);
    });

    const results = scored.slice(0, topK);

    operationLogger.debug({
      event: "storage.hierarchical.search_content.completed",
      message: "Searched content embeddings.",
      context: {
        topK,
        parentId: parentId ?? null,
        candidateCount: candidates.length,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      }
    });
    return results;
  }

  public async upsertSummary(nodeId: string, summary: SummaryRecord): Promise<void> {
    await this.ensureVectorDbOpen();
    this.summaries.set(nodeId, { ...summary });
    await this.persistState();

    logger.debug({
      event: "storage.hierarchical.upsert_summary.completed",
      message: "Upserted node summary.",
      context: { nodeId }
    });
  }

  public async getSummary(nodeId: string): Promise<SummaryRecord | null> {
    await this.ensureVectorDbOpen();
    const summary = this.summaries.get(nodeId);
    return summary ? { ...summary } : null;
  }

  public async upsertEmbedding(
    nodeId: string,
    embeddingType: EmbeddingType,
    vector: EmbeddingVector
  ): Promise<void> {
    await this.ensureVectorDbOpen();
    this.embeddings = this.embeddings.filter(
      (e) => !(e.nodeId === nodeId && e.embeddingType === embeddingType)
    );
    this.embeddings.push({
      nodeId,
      embeddingType,
      vector: { values: [...vector.values], dimensions: vector.dimensions }
    });
    await this.persistState();

    logger.debug({
      event: "storage.hierarchical.upsert_embedding.completed",
      message: "Upserted node embedding.",
      context: { nodeId, embeddingType, dimensions: vector.dimensions }
    });
  }

  public async upsertTags(nodeId: string, tags: string[]): Promise<void> {
    await this.ensureVectorDbOpen();
    this.tags.set(nodeId, [...tags]);
    await this.persistState();

    logger.debug({
      event: "storage.hierarchical.upsert_tags.completed",
      message: "Upserted node tags.",
      context: { nodeId, tagCount: tags.length }
    });
  }

  public async getNodesByTag(tag: string, parentId?: string): Promise<DocumentNode[]> {
    await this.ensureVectorDbOpen();
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
      return [];
    }

    const matchingNodeIds: string[] = [];
    for (const [nodeId, nodeTags] of this.tags) {
      if (nodeTags.includes(normalizedTag)) {
        matchingNodeIds.push(nodeId);
      }
    }

    if (parentId === undefined) {
      const result: DocumentNode[] = [];
      for (const nodeId of matchingNodeIds) {
        const node = this.nodes.get(nodeId);
        if (node) {
          result.push({ ...node });
        }
      }
      return result;
    }

    const descendantIds = this.collectDescendantIds(parentId);
    const result: DocumentNode[] = [];
    for (const nodeId of matchingNodeIds) {
      if (descendantIds.has(nodeId)) {
        const node = this.nodes.get(nodeId);
        if (node) {
          result.push({ ...node });
        }
      }
    }
    return result;
  }

  private collectDescendantIds(parentId: string): Set<string> {
    const descendants = new Set<string>();
    const queue = [parentId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const entries = this.children.get(current);
      if (entries) {
        for (const entry of entries) {
          descendants.add(entry.childId);
          queue.push(entry.childId);
        }
      }
    }
    return descendants;
  }

  public async upsertCrossReferences(refs: CrossReference[]): Promise<void> {
    await this.ensureVectorDbOpen();
    for (const ref of refs) {
      const existing = this.crossRefs.get(ref.sourceNodeId) ?? [];
      existing.push({ ...ref });
      this.crossRefs.set(ref.sourceNodeId, existing);
    }
    await this.persistState();

    logger.debug({
      event: "storage.hierarchical.upsert_cross_refs.completed",
      message: "Upserted cross-references.",
      context: { refCount: refs.length }
    });
  }

  public async getCrossReferences(nodeId: string): Promise<CrossReference[]> {
    await this.ensureVectorDbOpen();
    const refs = this.crossRefs.get(nodeId);
    return refs ? refs.map((r) => ({ ...r })) : [];
  }

  private searchEmbeddingsByType(
    vector: EmbeddingVector,
    topK: number,
    type: EmbeddingType
  ): NodeMatch[] {
    const candidates = this.embeddings.filter((e) => e.embeddingType === type);
    const scored: NodeMatch[] = [];

    for (const candidate of candidates) {
      const score = cosineSimilarity(vector, candidate.vector);
      if (score !== null) {
        scored.push({
          nodeId: candidate.nodeId,
          score,
          embeddingType: type
        });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.nodeId.localeCompare(b.nodeId);
    });

    return scored.slice(0, topK);
  }

  private removeByNotePath(notePath: string): number {
    const nodeIdsToRemove: string[] = [];
    for (const [nodeId, node] of this.nodes) {
      if (node.notePath === notePath) {
        nodeIdsToRemove.push(nodeId);
      }
    }

    for (const nodeId of nodeIdsToRemove) {
      this.nodes.delete(nodeId);
      this.children.delete(nodeId);
      this.summaries.delete(nodeId);
      this.tags.delete(nodeId);
      this.crossRefs.delete(nodeId);
    }

    const removedSet = new Set(nodeIdsToRemove);
    this.embeddings = this.embeddings.filter((e) => !removedSet.has(e.nodeId));

    for (const [parentId, entries] of this.children) {
      const filtered = entries.filter((e) => !removedSet.has(e.childId));
      if (filtered.length === 0) {
        this.children.delete(parentId);
      } else {
        this.children.set(parentId, filtered);
      }
    }

    return nodeIdsToRemove.length;
  }

  private async loadState(): Promise<void> {
    const startedAt = Date.now();
    const rawRoot = await this.plugin.loadData();
    if (!isRecord(rawRoot)) {
      logger.info({
        event: "storage.hierarchical.load.baseline",
        message: "No persisted hierarchical state found; starting with empty state.",
        context: { elapsedMs: Date.now() - startedAt }
      });
      return;
    }

    const rawState = rawRoot[HIERARCHICAL_STORE_KEY];
    if (!isRecord(rawState)) {
      logger.info({
        event: "storage.hierarchical.load.baseline",
        message: "No persisted hierarchical state found; starting with empty state.",
        context: { elapsedMs: Date.now() - startedAt }
      });
      return;
    }

    try {
      const state = rawState as unknown as PersistedHierarchicalState;

      if (Array.isArray(state.nodes)) {
        this.nodes = new Map(state.nodes);
      }
      if (Array.isArray(state.children)) {
        this.children = new Map(state.children);
      }
      if (Array.isArray(state.summaries)) {
        this.summaries = new Map(state.summaries);
      }
      if (Array.isArray(state.embeddings)) {
        this.embeddings = state.embeddings;
      }
      if (Array.isArray(state.tags)) {
        this.tags = new Map(state.tags);
      }
      if (Array.isArray(state.crossRefs)) {
        this.crossRefs = new Map(state.crossRefs);
      }

      logger.info({
        event: "storage.hierarchical.load.completed",
        message: "Loaded persisted hierarchical state.",
        context: {
          nodeCount: this.nodes.size,
          embeddingCount: this.embeddings.length,
          summaryCount: this.summaries.size,
          elapsedMs: Date.now() - startedAt
        }
      });
    } catch {
      logger.warn({
        event: "storage.hierarchical.load.parse_failed",
        message: "Failed to parse persisted hierarchical state; starting with empty state.",
        context: { elapsedMs: Date.now() - startedAt }
      });
    }
  }

  private async persistState(): Promise<void> {
    const startedAt = Date.now();
    const rawRoot = await this.plugin.loadData();
    const root = isRecord(rawRoot) ? { ...rawRoot } : {};

    const state: PersistedHierarchicalState = {
      nodes: [...this.nodes.entries()],
      children: [...this.children.entries()],
      summaries: [...this.summaries.entries()],
      embeddings: this.embeddings,
      tags: [...this.tags.entries()],
      crossRefs: [...this.crossRefs.entries()]
    };

    root[HIERARCHICAL_STORE_KEY] = state;
    await this.plugin.saveData(root);

    logger.debug({
      event: "storage.hierarchical.persist.completed",
      message: "Persisted hierarchical state.",
      context: {
        nodeCount: this.nodes.size,
        elapsedMs: Date.now() - startedAt
      }
    });
  }
}
