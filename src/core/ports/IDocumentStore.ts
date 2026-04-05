import type {
  DocumentNode,
  EmbedMeta,
  NodeFilter,
  NoteMeta,
  VectorMatch,
  VectorType,
} from '../domain/types.js';

/**
 * Hierarchical document + vector store (README hexagonal §1, API Contract).
 * Implementations live in the sidecar (e.g. SQLite + sqlite-vec); core stays storage-agnostic.
 */
export interface IDocumentStore {
  upsertNodes(nodes: DocumentNode[]): Promise<void>;
  getNodesByNote(noteId: string): Promise<DocumentNode[]>;
  deleteNote(noteId: string): Promise<void>;
  upsertSummary(nodeId: string, summary: string, model: string): Promise<void>;
  upsertEmbedding(
    nodeId: string,
    type: VectorType,
    vector: Float32Array,
    meta: EmbedMeta,
  ): Promise<void>;
  searchSummaryVectors(query: Float32Array, k: number): Promise<VectorMatch[]>;
  searchContentVectors(
    query: Float32Array,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]>;
  getAncestors(nodeId: string): Promise<DocumentNode[]>;
  getSiblings(nodeId: string): Promise<DocumentNode[]>;
  getNoteMeta(noteId: string): Promise<NoteMeta | null>;
  upsertNoteMeta(meta: NoteMeta): Promise<void>;
}
