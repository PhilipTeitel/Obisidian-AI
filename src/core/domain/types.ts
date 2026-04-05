/**
 * Shared domain types for hierarchical documents (ADR-002), indexing state (ADR-008),
 * and port payloads. Spelling of literals must match README SQLite CHECK constraints.
 */

/** SQLite `nodes.type` CHECK — exactly these seven values (FND-3 Y4). */
export type NodeType =
  | 'note'
  | 'topic'
  | 'subtopic'
  | 'paragraph'
  | 'sentence_part'
  | 'bullet_group'
  | 'bullet';

/**
 * In-memory / API shape for a row in `nodes`. Timestamps are ISO strings at the DB boundary.
 */
export interface DocumentNode {
  id: string;
  noteId: string;
  parentId: string | null;
  type: NodeType;
  /** Ancestor headings from root to parent (JSON array in SQLite). */
  headingTrail: string[];
  depth: number;
  siblingOrder: number;
  content: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export type VectorType = 'content' | 'summary';

export interface EmbedMeta {
  model: string;
  dimension: number;
  contentHash: string;
}

export interface VectorMatch {
  nodeId: string;
  score: number;
}

/** Optional filter for content-vector ANN search (README API Contract). */
export interface NodeFilter {
  noteIds?: string[];
  nodeTypes?: NodeType[];
}

export interface NoteMeta {
  noteId: string;
  vaultPath: string;
  contentHash: string;
  indexedAt: string;
  nodeCount: number;
}

/** `job_steps.current_step` CHECK (README §8 / ADR-008) — lowercase snake_case. */
export type IndexStep =
  | 'queued'
  | 'parsing'
  | 'parsed'
  | 'storing'
  | 'stored'
  | 'summarizing'
  | 'summarized'
  | 'embedding'
  | 'embedded'
  | 'failed'
  | 'dead_letter';

export type IndexProgressStatus = 'started' | 'completed' | 'failed' | 'skipped';

/**
 * Per-note step progress (ADR-008 §4). `runId` correlates a full/incremental indexing run (README).
 */
export interface IndexProgressEvent {
  jobId: string;
  runId: string;
  notePath: string;
  step: IndexStep;
  status: IndexProgressStatus;
  detail?: string;
}

/** UI / transport progress payload (union for future non-index events). */
export type ProgressEvent = IndexProgressEvent;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface VaultFile {
  path: string;
}

/** Outbound link extracted during chunking (CHK-4); persisted as `cross_refs` in SQLite. */
export interface ParsedCrossRef {
  sourceNodeId: string;
  targetPath: string;
  linkText: string | null;
}

/** Tag scoped to a structural node (CHK-5); persisted as `tags` in SQLite. */
export interface ParsedTag {
  nodeId: string;
  tag: string;
  source: 'frontmatter' | 'inline';
}

/** Result of parsing one vault note (CHK-4+). */
export interface ChunkNoteResult {
  nodes: DocumentNode[];
  crossRefs: ParsedCrossRef[];
  tags: ParsedTag[];
}

/** Inputs for `chunkNote` (CHK-4+). */
export interface ChunkNoteInput {
  noteId: string;
  noteTitle: string;
  /** Vault-relative path of this note (resolves relative markdown links). */
  vaultPath: string;
  markdown: string;
  /**
   * When omitted, chunker uses `DEFAULT_MAX_EMBEDDING_TOKENS` from token estimator (CHK-2).
   */
  maxEmbeddingTokens?: number;
}

/** One dequeue-able unit from `IQueuePort` (ADR-007). */
export interface QueueItem<T> {
  id: string;
  payload: T;
}

// --- Sidecar wire shapes (README API Contract; framing deferred to SRV-*) ---

export interface IndexFilePayload {
  path: string;
  content: string;
  hash: string;
}

export interface IndexFullRequest {
  files: IndexFilePayload[];
  apiKey?: string;
}

export interface IndexIncrementalRequest {
  files: IndexFilePayload[];
  deletedPaths: string[];
  apiKey?: string;
}

export interface IndexRunAck {
  runId: string;
  noteCount: number;
}

export interface JobStep {
  jobId: string;
  notePath: string;
  currentStep: IndexStep;
  contentHash: string;
  retryCount: number;
  errorMessage: string | null;
  updatedAt: string;
}

export interface IndexStatusResponse {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  jobs: JobStep[];
}

export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
}

export interface SearchResult {
  nodeId: string;
  notePath: string;
  score: number;
  snippet: string;
  headingTrail: string[];
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface Source {
  notePath: string;
  nodeId?: string;
}

export type ChatStreamChunk =
  | { type: 'delta'; delta: string }
  | { type: 'done'; sources: Source[] };

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  dbReady: boolean;
}

export interface OkResponse {
  ok: true;
}

/** Discriminated client → sidecar requests (NDJSON `type` / HTTP route names). */
export type SidecarRequest =
  | { type: 'index/full'; payload: IndexFullRequest }
  | { type: 'index/incremental'; payload: IndexIncrementalRequest }
  | { type: 'index/status'; payload?: Record<string, never> }
  | { type: 'search'; payload: SearchRequest }
  | { type: 'chat'; payload: { messages: ChatMessage[]; context?: string; apiKey?: string } }
  | { type: 'chat/clear'; payload?: Record<string, never> }
  | { type: 'health'; payload?: Record<string, never> };

/** Typed responses for `send()` — streaming `chat` uses `streamChat()` on `ISidecarTransport`. */
export type SidecarResponse =
  | { type: 'index/full'; body: IndexRunAck }
  | { type: 'index/incremental'; body: IndexRunAck }
  | { type: 'index/status'; body: IndexStatusResponse }
  | { type: 'search'; body: SearchResponse }
  | { type: 'chat/clear'; body: OkResponse }
  | { type: 'health'; body: HealthResponse };

/** Sidecar → plugin push (e.g. over WebSocket or multiplexed stdio). */
export type SidecarPushMessage = {
  type: 'progress';
  event: IndexProgressEvent;
};
