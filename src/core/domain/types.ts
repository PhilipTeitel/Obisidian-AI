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

/** Row shape for `summaries` (read path for WKF-1 / WKF-3 / WKF-4). */
export interface StoredSummary {
  summary: string;
  generatedAt: string;
  model: string | null;
  /** Rubric / prose era stamp (`legacy` until regenerated; WKF-4). */
  promptVersion: string;
}

export interface VectorMatch {
  nodeId: string;
  score: number;
}

/** Optional filter for content-vector ANN search (README API Contract). */
export interface NodeFilter {
  noteIds?: string[];
  nodeTypes?: NodeType[];
  /** Limit hits to these nodes and all descendants (Phase 2 drill-down, RET-1). */
  subtreeRootNodeIds?: string[];
  /** OR semantics: node matches if it has any of these tags (case-insensitive), RET-3. */
  tagsAny?: string[];
  /**
   * Union regex for `note_meta.vault_path` (compiled from `SearchRequest.pathGlobs` in the workflow).
   * Enforced in the store before ANN scoring (ADR-014 / RET-6).
   */
  pathRegex?: string;
  /**
   * One SQL LIKE pattern per glob; OR together as a fast prefilter with `pathRegex` as the precise check.
   */
  pathLikes?: string[];
  /** Inclusive ISO date range on `note_meta.note_date`; NULL dates excluded when set (ADR-014). */
  dateRange?: { start?: string; end?: string };
}

export interface NoteMeta {
  noteId: string;
  vaultPath: string;
  contentHash: string;
  indexedAt: string;
  nodeCount: number;
  /** Parsed from daily-note filename when path matches settings; otherwise null (ADR-014 / STO-4). */
  noteDate?: string | null;
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

/**
 * Payload in `queue_items.payload` for indexing (QUE-1 JSON-serializable object: no functions,
 * no `undefined` values in serialized payloads).
 * Use vault-relative path as `noteId` for MVP (matches `note_meta` / chunker).
 */
export interface NoteIndexJob {
  /** Correlates `job_steps` rows and progress with the client indexing run (`IndexRunAck.runId`). */
  runId: string;
  noteId: string;
  vaultPath: string;
  noteTitle: string;
  markdown: string;
  contentHash: string;
  dailyNotePathGlobs?: string[];
  dailyNoteDatePattern?: string;
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
  /** Defaults applied in the indexer when omitted (RET-6). */
  dailyNotePathGlobs?: string[];
  dailyNoteDatePattern?: string;
}

export interface IndexIncrementalRequest {
  files: IndexFilePayload[];
  deletedPaths: string[];
  apiKey?: string;
  dailyNotePathGlobs?: string[];
  dailyNoteDatePattern?: string;
}

export interface IndexRunAck {
  runId: string;
  scannedCount: number;
  noteCount: number;
  enqueuedCount: number;
  skippedCount: number;
  deletedCount: number;
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
  /** Optional tag filter (OR, case-insensitive); forwarded to Phase 1 prune + Phase 2 ANN. */
  tags?: string[];
  /** Optional path scope (ADR-014); RET-6 owns full semantics; RET-5 passes through to the store. */
  pathGlobs?: string[];
  /** Optional parsed daily-note date range (ADR-014); RET-5 passes through to the store. */
  dateRange?: { start?: string; end?: string };
  /**
   * Phase-1 summary ANN limit (RET-4 / ADR-012). Clamped to [1, 256]; default 32 when omitted.
   */
  coarseK?: number;
  /** Context assembly from plugin settings; when omitted, SearchWorkflow uses README defaults. */
  search?: SearchAssemblyOptions;
  /**
   * RET-5 hybrid toggle; RET-4: content-only fallback must not consult this (ADR-012 Decision 5).
   */
  enableHybridSearch?: boolean;
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

/** Fractions of `totalTokenBudget` for the three assembly tiers (README Plugin Settings). */
export interface ContextBudgetConfig {
  matchedContent: number;
  siblingContext: number;
  parentSummary: number;
}

export interface SearchAssemblyOptions {
  budget: ContextBudgetConfig;
  /** Token budget for the three tier bodies (headings/labels are added outside this budget). */
  totalTokenBudget: number;
  /**
   * Max estimated tokens for the combined chat retrieval string (multi-snippet stitch).
   * When omitted, `contextAssembly.resolveChatStitchMaxTokens` uses max(512, totalTokenBudget × 8).
   */
  chatStitchMaxTokens?: number;
}

/** Internal bookkeeping: nodes whose snippets were stitched into chat retrieval context (BUG-1 / ADR-015). */
export interface UsedNodeRecord {
  nodeId: string;
  notePath: string;
  /** Order in which the node first entered the stitched context. */
  insertionOrder: number;
}

export interface Source {
  notePath: string;
  nodeId?: string;
}

/** Terminal chat outcome (ADR-011 / CHAT-3). */
export type GroundingOutcome = 'answered' | 'insufficient_evidence';

/** Wire version echoed on chat terminal events; keep in sync with sidecar `GROUNDING_POLICY_VERSION`. */
export const CHAT_GROUNDING_POLICY_WIRE_VERSION = 'v1';

/** Hooks for message assembly (CHAT-4); logging stays out of pure core except via injected callbacks. */
export interface BuildGroundedMessagesHooks {
  /** Share of estimated user-prompt tokens removed to satisfy the combined system-message budget (0–1). */
  onUserPromptTruncated?: (ratio: number) => void;
}

/** Inputs for vault-only message assembly; policy text lives in sidecar (CHAT-3 Y4). */
export interface GroundingContext {
  /** Persona / style from plugin settings (`chatSystemPrompt`), per request (CHAT-4). */
  systemPrompt?: string;
  /** Vault organization hints from plugin settings, per request (CHAT-4). */
  vaultOrganizationPrompt?: string;
  /** Assembled retrieval text; may be empty (insufficient-evidence path skips the model). */
  retrievalContext: string;
}

export type ChatStreamChunk =
  | { type: 'delta'; delta: string }
  | {
      type: 'done';
      sources: Source[];
      groundingOutcome: GroundingOutcome;
      groundingPolicyVersion: string;
    };

export interface HealthResponse {
  status: 'ok';
  /** Process uptime in whole seconds since sidecar start. */
  uptime: number;
  dbReady: boolean;
}

export interface OkResponse {
  ok: true;
}

/**
 * Client → sidecar `chat` request body (ADR-011 Decision 4, README API Contract).
 * User prompts use wire names `systemPrompt` / `vaultOrganizationPrompt` (plugin settings: `chatSystemPrompt` / `vaultOrganizationPrompt`).
 */
export interface ChatRequestPayload {
  messages: ChatMessage[];
  context?: string;
  apiKey?: string;
  /** Wall-clock budget for the stream (maps to `IChatPort` / workflow; ADR-009). */
  timeoutMs?: number;
  /** Phase-1 coarse-K (RET-4); defaults in workflow when omitted. */
  coarseK?: number;
  /** Final search `k` for retrieval (defaults in ChatWorkflow when omitted). */
  k?: number;
  /** Assembly budgets from plugin settings (RET-2 / RET-4). */
  search?: SearchAssemblyOptions;
  enableHybridSearch?: boolean;
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
  /** Persona from plugin `chatSystemPrompt`; ordering enforced in `buildGroundedMessages`. */
  systemPrompt?: string;
  vaultOrganizationPrompt?: string;
  /** Echoed for logging / copy tuning (ADR-011). */
  groundingPolicyVersion?: string;
  /** BUG-3 / ADR-016: integer UTC offset (−12..+14) when local TZ is undetectable in the sidecar. */
  timezoneUtcOffsetHours?: number;
  /** BUG-3: daily-note globs from settings; paired with resolved NL date range for retrieval. */
  dailyNotePathGlobs?: string[];
}

/** Discriminated client → sidecar requests (NDJSON `type` / HTTP route names). */
export type SidecarRequest =
  | { type: 'index/full'; payload: IndexFullRequest }
  | { type: 'index/incremental'; payload: IndexIncrementalRequest }
  | { type: 'index/status'; payload?: Record<string, never> }
  | { type: 'search'; payload: SearchRequest }
  | { type: 'chat'; payload: ChatRequestPayload }
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
