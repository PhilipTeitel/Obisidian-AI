/**
 * In-memory hierarchical store for Vitest. Browser WASM SQLite cannot run under Node;
 * production uses {@link SqliteVecRepository} with real SQL + sqlite-vec.
 */
import type {
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingType,
  EmbeddingVector,
  HierarchicalStoreContract,
  NodeMatch,
  RuntimeServiceLifecycle,
  SummaryRecord
} from "../../types";

interface StoredEmbedding {
  nodeId: string;
  embeddingType: EmbeddingType;
  vector: EmbeddingVector;
}

interface ChildEntry {
  childId: string;
  sortOrder: number;
}

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

export class MemoryHierarchicalStore implements HierarchicalStoreContract, RuntimeServiceLifecycle {
  private nodes = new Map<string, DocumentNode>();
  private children = new Map<string, ChildEntry[]>();
  private summaries = new Map<string, SummaryRecord>();
  private embeddings: StoredEmbedding[] = [];
  private tags = new Map<string, string[]>();
  private crossRefs = new Map<string, CrossReference[]>();
  private disposed = false;

  public async init(): Promise<void> {
    this.ensureNotDisposed();
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  private ensureNotDisposed(): void {
    if (!this.disposed) {
      return;
    }
    throw new Error("Memory hierarchical store has been disposed.");
  }

  public async upsertNodeTree(tree: DocumentTree): Promise<void> {
    this.ensureNotDisposed();
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
  }

  public async deleteByNotePath(notePath: string): Promise<void> {
    this.ensureNotDisposed();
    this.removeByNotePath(notePath);
  }

  public async getNode(nodeId: string): Promise<DocumentNode | null> {
    this.ensureNotDisposed();
    const node = this.nodes.get(nodeId);
    return node ? { ...node } : null;
  }

  public async getChildren(nodeId: string): Promise<DocumentNode[]> {
    this.ensureNotDisposed();
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
    this.ensureNotDisposed();
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
    this.ensureNotDisposed();
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
    this.ensureNotDisposed();
    const result: DocumentNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.notePath === notePath) {
        result.push({ ...node });
      }
    }
    return result;
  }

  public async searchSummaryEmbeddings(vector: EmbeddingVector, topK: number): Promise<NodeMatch[]> {
    this.ensureNotDisposed();
    return this.searchEmbeddingsByType(vector, topK, "summary");
  }

  public async searchContentEmbeddings(
    vector: EmbeddingVector,
    topK: number,
    parentId?: string
  ): Promise<NodeMatch[]> {
    this.ensureNotDisposed();
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

    return scored.slice(0, topK);
  }

  public async upsertSummary(nodeId: string, summary: SummaryRecord): Promise<void> {
    this.ensureNotDisposed();
    this.summaries.set(nodeId, { ...summary });
  }

  public async getSummary(nodeId: string): Promise<SummaryRecord | null> {
    this.ensureNotDisposed();
    const summary = this.summaries.get(nodeId);
    return summary ? { ...summary } : null;
  }

  public async upsertEmbedding(
    nodeId: string,
    embeddingType: EmbeddingType,
    vector: EmbeddingVector
  ): Promise<void> {
    this.ensureNotDisposed();
    this.embeddings = this.embeddings.filter(
      (e) => !(e.nodeId === nodeId && e.embeddingType === embeddingType)
    );
    this.embeddings.push({
      nodeId,
      embeddingType,
      vector: { values: [...vector.values], dimensions: vector.dimensions }
    });
  }

  public async upsertTags(nodeId: string, tags: string[]): Promise<void> {
    this.ensureNotDisposed();
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const t of tags) {
      const n = t.trim().toLowerCase();
      if (n.length === 0 || seen.has(n)) continue;
      seen.add(n);
      normalized.push(n);
    }
    this.tags.set(nodeId, normalized);
  }

  public async getNodesByTag(tag: string, parentId?: string): Promise<DocumentNode[]> {
    this.ensureNotDisposed();
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

  public async upsertCrossReferences(refs: CrossReference[]): Promise<void> {
    this.ensureNotDisposed();
    for (const ref of refs) {
      const existing = this.crossRefs.get(ref.sourceNodeId) ?? [];
      existing.push({ ...ref });
      this.crossRefs.set(ref.sourceNodeId, existing);
    }
  }

  public async getCrossReferences(nodeId: string): Promise<CrossReference[]> {
    this.ensureNotDisposed();
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
}
