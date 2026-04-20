import type {
  DocumentNode,
  EmbedMeta,
  NodeFilter,
  NoteMeta,
  ParsedCrossRef,
  ParsedTag,
  StoredSummary,
  VectorMatch,
  VectorType,
} from '../domain/types.js';

/**
 * Hierarchical document + vector store (README hexagonal §1, API Contract).
 * Implementations live in the sidecar (e.g. SQLite + sqlite-vec); core stays storage-agnostic.
 */
export interface IDocumentStore {
  upsertNodes(nodes: DocumentNode[]): Promise<void>;
  /** Replace all `tags` rows for nodes belonging to `noteId` (call after `upsertNodes`). */
  replaceNoteTags(noteId: string, tags: ParsedTag[]): Promise<void>;
  /** Replace all `cross_refs` rows sourced from nodes of `noteId` (call after `upsertNodes`). */
  replaceNoteCrossRefs(noteId: string, refs: ParsedCrossRef[]): Promise<void>;
  getNodesByNote(noteId: string): Promise<DocumentNode[]>;
  /** Single node by id (retrieval / assembly). */
  getNodeById(nodeId: string): Promise<DocumentNode | null>;
  deleteNote(noteId: string): Promise<void>;
  upsertSummary(
    nodeId: string,
    summary: string,
    model: string,
    promptVersion: string,
  ): Promise<void>;
  getSummary(nodeId: string): Promise<StoredSummary | null>;
  getEmbeddingMeta(nodeId: string, vectorType: VectorType): Promise<EmbedMeta | null>;
  upsertEmbedding(
    nodeId: string,
    type: VectorType,
    vector: Float32Array,
    meta: EmbedMeta,
  ): Promise<void>;
  searchSummaryVectors(
    query: Float32Array,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]>;
  /**
   * BM25-ranked keyword search over FTS5 `nodes.content` (ADR-012). `score` is BM25 (lower is better).
   */
  searchContentKeyword(
    query: string,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]>;
  searchContentVectors(query: Float32Array, k: number, filter?: NodeFilter): Promise<VectorMatch[]>;
  getAncestors(nodeId: string): Promise<DocumentNode[]>;
  getSiblings(nodeId: string): Promise<DocumentNode[]>;
  getNoteMeta(noteId: string): Promise<NoteMeta | null>;
  upsertNoteMeta(meta: NoteMeta): Promise<void>;
  /**
   * True if any `tags` row for this note matches one of `tagsAny` (case-insensitive). RET-3 Phase 1 prune.
   */
  noteMatchesTagFilter(noteId: string, tagsAny: string[]): Promise<boolean>;
}
