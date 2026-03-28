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
  NodeType,
  RuntimeBootstrapContext,
  RuntimeServiceLifecycle,
  SummaryRecord
} from "../types";

const logger = createRuntimeLogger("SqliteVecRepository");

/** sqlite-vec vec0 column width in migration 003. */
const VEC_DIMENSION = 1536;

export interface SqliteVecRepositoryDeps {
  plugin: RuntimeBootstrapContext["plugin"];
  pluginId: string;
  getVectorStoreAbsolutePath?: () => string;
  getSqliteWasmAssetDir?: () => string;
  openVectorStoreDatabase?: (
    options: OpenVectorStoreDatabaseOptions
  ) => Promise<SqliteDatabaseHandle>;
  /**
   * Vitest-only: Node cannot load the browser WASM bundle; tests delegate to this in-memory store.
   * Never set in Obsidian bootstrap.
   */
  hierarchicalTestBackend?: HierarchicalStoreContract & RuntimeServiceLifecycle;
}

type StoreDb = SqliteDatabaseHandle;

const clampTopK = (topK: number): number => {
  const k = Math.floor(topK);
  if (!Number.isFinite(k) || k < 1) {
    return 1;
  }
  return Math.min(k, 500);
};

const padEmbeddingToVec = (vector: EmbeddingVector): Float32Array => {
  const out = new Float32Array(VEC_DIMENSION);
  const src = vector.values;
  const n = Math.min(src.length, VEC_DIMENSION);
  for (let i = 0; i < n; i += 1) {
    out[i] = src[i]!;
  }
  return out;
};

/**
 * sqlite3 WASM `Stmt.bind()` only allows Uint8Array / Int8Array / ArrayBuffer for blobs.
 * `Float32Array` is rejected as `typeof "object"` → "Unsupported bind() argument type: object".
 * sqlite-vec still receives the same little-endian float32 bytes.
 */
const float32VecAsSqliteBlob = (vec: Float32Array): Uint8Array =>
  new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);

const distanceToScore = (distance: unknown): number => {
  const d = typeof distance === "number" ? distance : Number(distance);
  if (!Number.isFinite(d)) {
    return 0;
  }
  return 1 / (1 + d);
};

const parseHeadingTrail = (raw: unknown): string[] => {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const normalizeTagsForStore = (tags: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const n = t.trim().toLowerCase();
    if (n.length === 0 || seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
  }
  return out;
};

const rowToNode = (
  row: Record<string, unknown>,
  childIds: string[],
  tags: string[]
): DocumentNode => ({
  nodeId: String(row.node_id),
  parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
  childIds,
  notePath: String(row.note_path),
  noteTitle: String(row.note_title),
  headingTrail: parseHeadingTrail(row.heading_trail),
  depth: Number(row.depth),
  nodeType: String(row.node_type) as NodeType,
  content: String(row.content),
  sequenceIndex: Number(row.sequence_index),
  tags,
  contentHash: String(row.content_hash),
  updatedAt: Number(row.updated_at)
});

export class SqliteVecRepository implements HierarchicalStoreContract, RuntimeServiceLifecycle {
  /** Passed through from bootstrap; hierarchical data lives in SQLite, not plugin data. */
  private readonly plugin: RuntimeBootstrapContext["plugin"];
  private readonly testBackend: (HierarchicalStoreContract & RuntimeServiceLifecycle) | null;
  private readonly getVectorStoreAbsolutePath: () => string;
  private readonly getSqliteWasmAssetDir: () => string;
  private readonly openVectorStoreDatabase: (
    options: OpenVectorStoreDatabaseOptions
  ) => Promise<SqliteDatabaseHandle>;
  private disposed = false;
  private vectorDbHandle: SqliteDatabaseHandle | null = null;
  private vectorDbOpenPromise: Promise<void> | null = null;

  public constructor(deps: SqliteVecRepositoryDeps) {
    this.plugin = deps.plugin;
    this.testBackend = deps.hierarchicalTestBackend ?? null;
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
    if (this.testBackend) {
      await this.testBackend.init();
    }
    logger.info({
      event: "storage.hierarchical.init.completed",
      message: "Hierarchical store initialized.",
      context: {
        mode: this.testBackend ? "test_backend" : "sqlite",
        elapsedMs: Date.now() - startedAt
      }
    });
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.vectorDbOpenPromise = null;
    if (this.testBackend) {
      await this.testBackend.dispose();
      return;
    }
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
    if (this.testBackend) {
      return;
    }
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

  private requireDb(): StoreDb {
    const h = this.vectorDbHandle;
    if (!h) {
      throw normalizeRuntimeError(new Error("Vector database is not open."), {
        operation: "SqliteVecRepository",
        phase: "db_missing",
        domainHint: "storage"
      });
    }
    return h;
  }

  private loadNode(db: StoreDb, nodeId: string): DocumentNode | null {
    const rows = db.selectObjects(
      `SELECT node_id, parent_id, note_path, note_title, heading_trail, depth, node_type, content, sequence_index, content_hash, updated_at
       FROM nodes WHERE node_id = ?`,
      [nodeId]
    );
    if (rows.length === 0) {
      return null;
    }
    const childRows = db.selectObjects(
      `SELECT child_id FROM node_children WHERE parent_id = ? ORDER BY sort_order ASC, child_id ASC`,
      [nodeId]
    );
    const tagRows = db.selectObjects(
      `SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag ASC`,
      [nodeId]
    );
    return rowToNode(
      rows[0]!,
      childRows.map((r) => String(r.child_id)),
      tagRows.map((r) => String(r.tag))
    );
  }

  public async upsertNodeTree(tree: DocumentTree): Promise<void> {
    if (this.testBackend) {
      return this.testBackend.upsertNodeTree(tree);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const notePath = tree.root.notePath;

    const orderedNodes = [...tree.nodes.values()].sort((a, b) => a.depth - b.depth);

    db.transaction((tx) => {
      tx.exec({ sql: "DELETE FROM nodes WHERE note_path = ?", bind: [notePath] });

      for (const node of orderedNodes) {
        tx.exec({
          sql: `INSERT INTO nodes (
            node_id, parent_id, note_path, note_title, heading_trail, depth, node_type, content, sequence_index, content_hash, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          bind: [
            node.nodeId,
            node.parentId,
            node.notePath,
            node.noteTitle,
            JSON.stringify(node.headingTrail),
            node.depth,
            node.nodeType,
            node.content,
            node.sequenceIndex,
            node.contentHash,
            node.updatedAt
          ]
        });
      }

      for (const node of orderedNodes) {
        node.childIds.forEach((childId, index) => {
          tx.exec({
            sql: "INSERT INTO node_children (parent_id, child_id, sort_order) VALUES (?, ?, ?)",
            bind: [node.nodeId, childId, index]
          });
        });
      }
    });

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
    if (this.testBackend) {
      return this.testBackend.deleteByNotePath(notePath);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();

    const before = db.selectValue(
      "SELECT COUNT(*) FROM nodes WHERE note_path = ?",
      notePath
    );
    const removedNodeCount = typeof before === "number" ? before : Number(before);

    db.transaction((tx) => {
      tx.exec({ sql: "DELETE FROM nodes WHERE note_path = ?", bind: [notePath] });
    });

    operationLogger.info({
      event: "storage.hierarchical.delete_by_note_path.completed",
      message: "Deleted nodes by note path.",
      context: { notePath, removedNodeCount, elapsedMs: Date.now() - startedAt }
    });
  }

  public async getNode(nodeId: string): Promise<DocumentNode | null> {
    if (this.testBackend) {
      return this.testBackend.getNode(nodeId);
    }
    await this.ensureVectorDbOpen();
    const node = this.loadNode(this.requireDb(), nodeId);
    return node ? { ...node, childIds: [...node.childIds], headingTrail: [...node.headingTrail], tags: [...node.tags] } : null;
  }

  public async getChildren(nodeId: string): Promise<DocumentNode[]> {
    if (this.testBackend) {
      return this.testBackend.getChildren(nodeId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const rows = db.selectObjects(
      `SELECT n.node_id, n.parent_id, n.note_path, n.note_title, n.heading_trail, n.depth, n.node_type, n.content, n.sequence_index, n.content_hash, n.updated_at
       FROM nodes n
       INNER JOIN node_children nc ON nc.child_id = n.node_id
       WHERE nc.parent_id = ?
       ORDER BY nc.sort_order ASC, n.node_id ASC`,
      [nodeId]
    );
    const result: DocumentNode[] = [];
    for (const row of rows) {
      const id = String(row.node_id);
      const childRows = db.selectObjects(
        `SELECT child_id FROM node_children WHERE parent_id = ? ORDER BY sort_order ASC, child_id ASC`,
        [id]
      );
      const tagRows = db.selectObjects(`SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag ASC`, [id]);
      const node = rowToNode(
        row,
        childRows.map((r) => String(r.child_id)),
        tagRows.map((r) => String(r.tag))
      );
      result.push({
        ...node,
        childIds: [...node.childIds],
        headingTrail: [...node.headingTrail],
        tags: [...node.tags]
      });
    }
    return result;
  }

  public async getAncestorChain(nodeId: string): Promise<DocumentNode[]> {
    if (this.testBackend) {
      return this.testBackend.getAncestorChain(nodeId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const chain: DocumentNode[] = [];
    const start = this.loadNode(db, nodeId);
    if (!start) {
      return chain;
    }
    let parentId = start.parentId;
    while (parentId !== null) {
      const parent = this.loadNode(db, parentId);
      if (!parent) {
        break;
      }
      chain.push({
        ...parent,
        childIds: [...parent.childIds],
        headingTrail: [...parent.headingTrail],
        tags: [...parent.tags]
      });
      parentId = parent.parentId;
    }
    return chain;
  }

  public async getSiblings(nodeId: string): Promise<DocumentNode[]> {
    if (this.testBackend) {
      return this.testBackend.getSiblings(nodeId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const node = this.loadNode(db, nodeId);
    if (!node) {
      return [];
    }
    if (node.parentId === null) {
      return [
        {
          ...node,
          childIds: [...node.childIds],
          headingTrail: [...node.headingTrail],
          tags: [...node.tags]
        }
      ];
    }
    return this.getChildren(node.parentId);
  }

  public async getNodesByNotePath(notePath: string): Promise<DocumentNode[]> {
    if (this.testBackend) {
      return this.testBackend.getNodesByNotePath(notePath);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const rows = db.selectObjects(
      `SELECT node_id FROM nodes WHERE note_path = ? ORDER BY depth ASC, sequence_index ASC, node_id ASC`,
      [notePath]
    );
    const result: DocumentNode[] = [];
    for (const row of rows) {
      const n = this.loadNode(db, String(row.node_id));
      if (n) {
        result.push({
          ...n,
          childIds: [...n.childIds],
          headingTrail: [...n.headingTrail],
          tags: [...n.tags]
        });
      }
    }
    return result;
  }

  public async searchSummaryEmbeddings(vector: EmbeddingVector, topK: number): Promise<NodeMatch[]> {
    if (this.testBackend) {
      return this.testBackend.searchSummaryEmbeddings(vector, topK);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const k = clampTopK(topK);
    const queryBlob = float32VecAsSqliteBlob(padEmbeddingToVec(vector));

    const rows = db.selectObjects(
      `SELECT node_id, distance FROM node_embeddings
       WHERE embedding MATCH ?
         AND k = ${k}
         AND embedding_type = 'summary'
       ORDER BY distance ASC, node_id ASC`,
      [queryBlob]
    );

    const matches: NodeMatch[] = rows.map((row) => ({
      nodeId: String(row.node_id),
      score: distanceToScore(row.distance),
      embeddingType: "summary" as const
    }));

    operationLogger.debug({
      event: "storage.hierarchical.search_summary.completed",
      message: "Searched summary embeddings (sqlite-vec).",
      context: { topK: k, resultCount: matches.length, elapsedMs: Date.now() - startedAt }
    });
    return matches;
  }

  public async searchContentEmbeddings(
    vector: EmbeddingVector,
    topK: number,
    parentId?: string
  ): Promise<NodeMatch[]> {
    if (this.testBackend) {
      return this.testBackend.searchContentEmbeddings(vector, topK, parentId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const k = clampTopK(topK);
    const queryBlob = float32VecAsSqliteBlob(padEmbeddingToVec(vector));

    const rows =
      parentId === undefined
        ? db.selectObjects(
            `SELECT node_id, distance FROM node_embeddings
             WHERE embedding MATCH ?
               AND k = ${k}
               AND embedding_type = 'content'
             ORDER BY distance ASC, node_id ASC`,
            [queryBlob]
          )
        : db.selectObjects(
            `SELECT ne.node_id AS node_id, ne.distance AS distance
             FROM node_embeddings AS ne
             INNER JOIN nodes AS n ON n.node_id = ne.node_id
             WHERE ne.embedding MATCH ?
               AND k = ${k}
               AND ne.embedding_type = 'content'
               AND n.parent_id = ?
             ORDER BY distance ASC, node_id ASC`,
            [queryBlob, parentId]
          );

    const matches: NodeMatch[] = rows.map((row) => ({
      nodeId: String(row.node_id),
      score: distanceToScore(row.distance),
      embeddingType: "content" as const
    }));

    operationLogger.debug({
      event: "storage.hierarchical.search_content.completed",
      message: "Searched content embeddings (sqlite-vec).",
      context: {
        topK: k,
        parentId: parentId ?? null,
        resultCount: matches.length,
        elapsedMs: Date.now() - startedAt
      }
    });
    return matches;
  }

  public async upsertSummary(nodeId: string, summary: SummaryRecord): Promise<void> {
    if (this.testBackend) {
      return this.testBackend.upsertSummary(nodeId, summary);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    db.exec({
      sql: `INSERT OR REPLACE INTO node_summaries (node_id, summary, model_used, prompt_version, generated_at)
            VALUES (?, ?, ?, ?, ?)`,
      bind: [nodeId, summary.summary, summary.modelUsed, summary.promptVersion, summary.generatedAt]
    });

    logger.debug({
      event: "storage.hierarchical.upsert_summary.completed",
      message: "Upserted node summary.",
      context: { nodeId }
    });
  }

  public async getSummary(nodeId: string): Promise<SummaryRecord | null> {
    if (this.testBackend) {
      return this.testBackend.getSummary(nodeId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const rows = db.selectObjects(
      `SELECT node_id, summary, model_used, prompt_version, generated_at FROM node_summaries WHERE node_id = ?`,
      [nodeId]
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    return {
      nodeId: String(row.node_id),
      summary: String(row.summary),
      modelUsed: String(row.model_used),
      promptVersion: String(row.prompt_version),
      generatedAt: Number(row.generated_at)
    };
  }

  public async upsertEmbedding(
    nodeId: string,
    embeddingType: EmbeddingType,
    vector: EmbeddingVector
  ): Promise<void> {
    if (this.testBackend) {
      return this.testBackend.upsertEmbedding(nodeId, embeddingType, vector);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const embeddingBlob = float32VecAsSqliteBlob(padEmbeddingToVec(vector));
    db.exec({
      sql: `INSERT OR REPLACE INTO node_embeddings (node_id, embedding_type, embedding) VALUES (?, ?, ?)`,
      bind: [nodeId, embeddingType, embeddingBlob]
    });

    logger.debug({
      event: "storage.hierarchical.upsert_embedding.completed",
      message: "Upserted node embedding.",
      context: { nodeId, embeddingType, dimensions: VEC_DIMENSION }
    });
  }

  public async upsertTags(nodeId: string, tags: string[]): Promise<void> {
    if (this.testBackend) {
      return this.testBackend.upsertTags(nodeId, tags);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const normalized = normalizeTagsForStore(tags);
    db.transaction((tx) => {
      tx.exec({ sql: "DELETE FROM node_tags WHERE node_id = ?", bind: [nodeId] });
      for (const tag of normalized) {
        tx.exec({
          sql: "INSERT OR REPLACE INTO node_tags (node_id, tag) VALUES (?, ?)",
          bind: [nodeId, tag]
        });
      }
    });

    logger.debug({
      event: "storage.hierarchical.upsert_tags.completed",
      message: "Upserted node tags.",
      context: { nodeId, tagCount: normalized.length }
    });
  }

  public async getNodesByTag(tag: string, parentId?: string): Promise<DocumentNode[]> {
    if (this.testBackend) {
      return this.testBackend.getNodesByTag(tag, parentId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
      return [];
    }

    const rows =
      parentId === undefined
        ? db.selectObjects(
            `SELECT n.node_id AS node_id
             FROM nodes n
             INNER JOIN node_tags t ON t.node_id = n.node_id
             WHERE t.tag = ?
             ORDER BY n.node_id ASC`,
            [normalizedTag]
          )
        : db.selectObjects(
            `WITH RECURSIVE descendants(nid) AS (
               SELECT child_id FROM node_children WHERE parent_id = ?
               UNION ALL
               SELECT nc.child_id FROM node_children nc
               INNER JOIN descendants d ON nc.parent_id = d.nid
             )
             SELECT n.node_id AS node_id
             FROM nodes n
             INNER JOIN node_tags t ON t.node_id = n.node_id
             WHERE t.tag = ? AND n.node_id IN (SELECT nid FROM descendants)
             ORDER BY n.node_id ASC`,
            [parentId, normalizedTag]
          );

    const result: DocumentNode[] = [];
    for (const row of rows) {
      const n = this.loadNode(db, String(row.node_id));
      if (n) {
        result.push({
          ...n,
          childIds: [...n.childIds],
          headingTrail: [...n.headingTrail],
          tags: [...n.tags]
        });
      }
    }
    return result;
  }

  public async upsertCrossReferences(refs: CrossReference[]): Promise<void> {
    if (this.testBackend) {
      return this.testBackend.upsertCrossReferences(refs);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    db.transaction((tx) => {
      for (const ref of refs) {
        tx.exec({
          sql: `INSERT INTO node_cross_refs (source_node_id, target_path, target_display) VALUES (?, ?, ?)`,
          bind: [ref.sourceNodeId, ref.targetPath, ref.targetDisplay]
        });
      }
    });

    logger.debug({
      event: "storage.hierarchical.upsert_cross_refs.completed",
      message: "Upserted cross-references.",
      context: { refCount: refs.length }
    });
  }

  public async getCrossReferences(nodeId: string): Promise<CrossReference[]> {
    if (this.testBackend) {
      return this.testBackend.getCrossReferences(nodeId);
    }
    await this.ensureVectorDbOpen();
    const db = this.requireDb();
    const rows = db.selectObjects(
      `SELECT source_node_id, target_path, target_display FROM node_cross_refs
       WHERE source_node_id = ? ORDER BY rowid ASC`,
      [nodeId]
    );
    return rows.map((row) => ({
      sourceNodeId: String(row.source_node_id),
      targetPath: String(row.target_path),
      targetDisplay:
        row.target_display === null || row.target_display === undefined
          ? null
          : String(row.target_display)
    }));
  }
}
