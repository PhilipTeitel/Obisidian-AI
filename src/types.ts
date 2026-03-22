import type { App, Plugin } from "obsidian";

export type ObsidianAIViewType = "obsidian-ai:search-view" | "obsidian-ai:chat-view";

export type ObsidianAICommandId =
  | "obsidian-ai:reindex-vault"
  | "obsidian-ai:index-changes"
  | "obsidian-ai:search-selection"
  | "obsidian-ai:open-semantic-search-pane"
  | "obsidian-ai:open-chat-pane";

export const MVP_PROVIDER_IDS = ["openai", "ollama"] as const;
export type MVPProviderId = (typeof MVP_PROVIDER_IDS)[number];
export type ProviderId = MVPProviderId | (string & {});
export type ProviderKind = "embedding" | "chat";
export type ChunkContextKind = "paragraph" | "bullet";

export interface ChunkReference {
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  blockRef?: string;
  tags: string[];
  contextKind?: ChunkContextKind;
}

export interface ChunkRecord {
  id: string;
  source: ChunkReference;
  content: string;
  hash: string;
  tokenEstimate?: number;
  updatedAt: number;
}

export interface ChunkerInput {
  notePath: string;
  noteTitle: string;
  markdown: string;
  updatedAt: number;
}

export interface ChunkerOptions {
  maxChunkChars?: number;
}

export interface EmbeddingVector {
  values: number[];
  dimensions: number;
}

export interface IndexedChunk extends ChunkRecord {
  embedding?: EmbeddingVector;
}

export interface EmbeddingRequest {
  providerId: ProviderId;
  model: string;
  inputs: string[];
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface EmbeddingResponse {
  providerId: ProviderId;
  model: string;
  vectors: EmbeddingVector[];
}

export interface EmbeddingInputFailure {
  inputIndex: number;
  message: string;
}

export interface EmbeddingProvider {
  readonly id: ProviderId;
  readonly name: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface LocalVectorStorePaths {
  rootDir: string;
  sqliteDbPath: string;
  migrationsDir: string;
}

export interface VectorStoreMigration {
  id: string;
  description: string;
  statements: string[];
}

export interface VectorStoreSchemaMetadata {
  schemaVersion: number;
  appliedMigrationIds: string[];
  paths: LocalVectorStorePaths;
}

export interface VectorStoreRow {
  chunkId: string;
  notePath: string;
  noteTitle: string;
  heading?: string;
  snippet: string;
  tags: string[];
  embedding: EmbeddingVector;
  updatedAt: number;
}

export interface VectorStoreQuery {
  vector: EmbeddingVector;
  topK: number;
  minScore?: number;
}

export interface VectorStoreMatch extends VectorStoreRow {
  score: number;
}

export interface VectorStoreRepositoryContract {
  getSchemaMetadata(): Promise<VectorStoreSchemaMetadata>;
  replaceAllFromChunks(chunks: ChunkRecord[], vectors: EmbeddingVector[]): Promise<void>;
  upsertFromChunks(chunks: ChunkRecord[], vectors: EmbeddingVector[]): Promise<void>;
  deleteByNotePaths(notePaths: string[]): Promise<void>;
  queryNearestNeighbors(query: VectorStoreQuery): Promise<VectorStoreMatch[]>;
}

export interface SecretStoreContract {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<boolean>;
  deleteSecret(key: string): Promise<boolean>;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatContextChunk {
  chunkId: string;
  notePath: string;
  heading?: string;
  snippet: string;
  score?: number;
}

export interface ChatRequest {
  providerId: ProviderId;
  model: string;
  messages: ChatMessage[];
  context: ChatContextChunk[];
  hierarchicalContext?: HierarchicalContextBlock[];
  timeoutMs: number;
}

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "done"; finishReason: "stop" | "length" | "error" }
  | { type: "error"; message: string; retryable: boolean };

export interface ChatProvider {
  readonly id: ProviderId;
  readonly name: string;
  complete(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface SearchRequest {
  query: string;
  topK: number;
  minScore?: number;
}

export interface SearchResult {
  chunkId: string;
  score: number;
  notePath: string;
  noteTitle: string;
  heading?: string;
  snippet: string;
  tags: string[];
}

export type JobType = "reindex-vault" | "index-changes" | "embed-batch" | "chat-completion";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type IndexingStage = "queued" | "crawl" | "chunk" | "summarize" | "embed" | "finalize";

export interface JobProgress {
  completed: number;
  total: number;
  label: string;
  detail?: string;
}

export interface JobSnapshot {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  progress: JobProgress;
  errorMessage?: string;
}

export interface IndexingRunOptions {
  onProgress?: (snapshot: JobSnapshot) => void;
}

export interface IndexedNoteFingerprint {
  notePath: string;
  noteHash: string;
  updatedAt: number;
}

export interface IndexManifest {
  version: 1;
  updatedAt: number;
  notes: IndexedNoteFingerprint[];
}

export interface IncrementalDiffResult {
  created: IndexedNoteFingerprint[];
  updated: IndexedNoteFingerprint[];
  unchanged: IndexedNoteFingerprint[];
  deleted: IndexedNoteFingerprint[];
}

export interface PersistedIndexJobState {
  activeJob: JobSnapshot | null;
  lastCompletedJob: JobSnapshot | null;
  history: JobSnapshot[];
}

export interface IndexConsistencyIssue {
  code: "STALE_ACTIVE_JOB" | "MANIFEST_SHAPE_INVALID" | "MANIFEST_VERSION_UNSUPPORTED";
  message: string;
  recoverable: boolean;
}

export interface IndexConsistencyReport {
  ok: boolean;
  issues: IndexConsistencyIssue[];
  requiresFullReindexBaseline: boolean;
}

export interface ObsidianAISettings {
  embeddingProvider: ProviderId;
  chatProvider: ProviderId;
  embeddingModel: string;
  chatModel: string;
  ollamaEndpoint: string;
  openaiEndpoint: string;
  indexedFolders: string[];
  excludedFolders: string[];
  agentOutputFolders: string[];
  maxGeneratedNoteSize: number;
  chatTimeout: number;
  logLevel: RuntimeLogLevel;
}

export type RuntimeLogContextValue = string | number | boolean | null | undefined;
export type RuntimeLogContext = Record<string, RuntimeLogContextValue>;

export type RuntimeErrorDomain = "provider" | "network" | "storage" | "runtime";

export interface NormalizedRuntimeError {
  domain: RuntimeErrorDomain;
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
  cause?: unknown;
  context?: RuntimeLogContext;
}

export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeLogEvent {
  level: RuntimeLogLevel;
  event: string;
  message: string;
  domain?: RuntimeErrorDomain;
  context?: RuntimeLogContext;
  error?: NormalizedRuntimeError;
  operationId?: string;
}

export type RuntimeLogInput = Omit<RuntimeLogEvent, "level">;

export interface RuntimeLoggerContract {
  log(event: RuntimeLogEvent): void;
  debug(event: RuntimeLogInput): void;
  info(event: RuntimeLogInput): void;
  warn(event: RuntimeLogInput): void;
  error(event: RuntimeLogInput): void;
  withOperation(operationId?: string): RuntimeLoggerContract;
}

export interface RuntimeServiceLifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ProviderRegistryContract extends RuntimeServiceLifecycle {
  getEmbeddingProviderId(): ProviderId;
  getChatProviderId(): ProviderId;
  registerEmbeddingProvider(provider: EmbeddingProvider): void;
  getEmbeddingProvider(providerId?: ProviderId): EmbeddingProvider;
  listEmbeddingProviders(): EmbeddingProvider[];
  registerChatProvider(provider: ChatProvider): void;
  getChatProvider(providerId?: ProviderId): ChatProvider;
  listChatProviders(): ChatProvider[];
}

export interface EmbeddingServiceContract extends RuntimeServiceLifecycle {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface SearchServiceContract extends RuntimeServiceLifecycle {
  search(request: SearchRequest): Promise<SearchResult[]>;
  searchSelection(selection: string): Promise<SearchResult[]>;
}

export interface ChatServiceContract extends RuntimeServiceLifecycle {
  chat(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface AgentServiceContract extends RuntimeServiceLifecycle {
  createNote(path: string, content: string): Promise<void>;
  updateNote(path: string, content: string): Promise<void>;
}

export interface IndexingServiceContract extends RuntimeServiceLifecycle {
  reindexVault(options?: IndexingRunOptions): Promise<JobSnapshot>;
  indexChanges(options?: IndexingRunOptions): Promise<JobSnapshot>;
  getActiveJob(): JobSnapshot | null;
}

export interface RuntimeBootstrapContext {
  app: App;
  plugin: Plugin;
  getSettings: () => ObsidianAISettings;
  notify: (message: string) => void;
}

export interface SummaryServiceContract extends RuntimeServiceLifecycle {
  generateSummaries(tree: DocumentTree, options?: { onNodeProcessed?: (event: { completed: number; total: number; currentNodeId: string; currentNodeType: string }) => void }): Promise<{ nodeId: string; skipped: boolean; error?: string }[]>;
  regenerateFromNode(nodeId: string): Promise<{ nodeId: string; skipped: boolean; error?: string }[]>;
  detectStaleSummaries(nodes: DocumentNode[]): Promise<{ nodeId: string; nodeUpdatedAt: number; summaryGeneratedAt: number | null }[]>;
  propagateSummariesForChangedNodes(changedNodeIds: string[]): Promise<{ nodeId: string; skipped: boolean; error?: string }[]>;
}

export interface ContextAssemblyServiceContract extends RuntimeServiceLifecycle {
  assemble(matches: LeafMatch[]): Promise<AssembledContext>;
}

export interface RuntimeServices {
  indexingService: IndexingServiceContract;
  embeddingService: EmbeddingServiceContract;
  searchService: SearchServiceContract;
  chatService: ChatServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
  summaryService: SummaryServiceContract;
  contextAssemblyService: ContextAssemblyServiceContract;
  hierarchicalStore: HierarchicalStoreContract;
  dispose(): Promise<void>;
}

export const RUNTIME_SERVICE_CONSTRUCTION_ORDER = [
  "providerRegistry",
  "embeddingService",
  "summaryService",
  "searchService",
  "contextAssemblyService",
  "agentService",
  "chatService",
  "indexingService"
] as const;

export type RuntimeServiceName = (typeof RUNTIME_SERVICE_CONSTRUCTION_ORDER)[number];

export interface RuntimeBootstrapResult {
  services: RuntimeServices;
  initializationOrder: RuntimeServiceName[];
}

// ── Hierarchical Node Types (R1) ──────────────────────────────────────

export type NodeType = "note" | "topic" | "subtopic" | "paragraph" | "bullet_group" | "bullet";

export interface DocumentNode {
  nodeId: string;
  parentId: string | null;
  childIds: string[];
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  depth: number;
  nodeType: NodeType;
  content: string;
  sequenceIndex: number;
  tags: string[];
  contentHash: string;
  updatedAt: number;
}

export interface DocumentTree {
  root: DocumentNode;
  nodes: Map<string, DocumentNode>;
}

// ── Summary Types (R2) ────────────────────────────────────────────────

export interface SummaryRecord {
  nodeId: string;
  summary: string;
  modelUsed: string;
  promptVersion: string;
  generatedAt: number;
}

// ── Embedding Types (hierarchical) ───────────────────────────────────

export type EmbeddingType = "content" | "summary";

export interface NodeMatch {
  nodeId: string;
  score: number;
  embeddingType: EmbeddingType;
}

// ── Cross-Reference Types (R9) ───────────────────────────────────────

export interface CrossReference {
  sourceNodeId: string;
  targetPath: string;
  targetDisplay: string | null;
}

// ── Hierarchical Retrieval Types (R6, R7) ────────────────────────────

export interface LeafMatch {
  node: DocumentNode;
  score: number;
  ancestorChain: DocumentNode[];
}

export interface ContextTierUsage {
  matchedContentTokens: number;
  siblingContextTokens: number;
  parentSummaryTokens: number;
}

export interface HierarchicalContextBlock {
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  matchedContent: string;
  siblingContent: string;
  parentSummary: string;
  score: number;
}

export interface AssembledContext {
  blocks: HierarchicalContextBlock[];
  tierUsage: ContextTierUsage;
}

// ── Hierarchical Search Request ──────────────────────────────────────

export interface HierarchicalSearchRequest {
  query: string;
  topK: number;
  minScore?: number;
}

// ── Hierarchical Search Result ───────────────────────────────────────

export interface HierarchicalSearchResult {
  nodeId: string;
  score: number;
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  matchedContent: string;
  parentSummary: string;
  siblingSnippet: string;
  tags: string[];
}

// ── Hierarchical Store Contract ──────────────────────────────────────

export interface HierarchicalStoreContract {
  upsertNodeTree(tree: DocumentTree): Promise<void>;
  deleteByNotePath(notePath: string): Promise<void>;
  getNode(nodeId: string): Promise<DocumentNode | null>;
  getChildren(nodeId: string): Promise<DocumentNode[]>;
  getAncestorChain(nodeId: string): Promise<DocumentNode[]>;
  getSiblings(nodeId: string): Promise<DocumentNode[]>;
  getNodesByNotePath(notePath: string): Promise<DocumentNode[]>;
  searchSummaryEmbeddings(vector: EmbeddingVector, topK: number): Promise<NodeMatch[]>;
  searchContentEmbeddings(vector: EmbeddingVector, topK: number, parentId?: string): Promise<NodeMatch[]>;
  upsertSummary(nodeId: string, summary: SummaryRecord): Promise<void>;
  getSummary(nodeId: string): Promise<SummaryRecord | null>;
  upsertEmbedding(nodeId: string, embeddingType: EmbeddingType, vector: EmbeddingVector): Promise<void>;
  upsertTags(nodeId: string, tags: string[]): Promise<void>;
  upsertCrossReferences(refs: CrossReference[]): Promise<void>;
  getCrossReferences(nodeId: string): Promise<CrossReference[]>;
}
