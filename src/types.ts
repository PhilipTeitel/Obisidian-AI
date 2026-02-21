import type { App, Plugin } from "obsidian";

export type ObsidianAIViewType = "obsidian-ai:search-view" | "obsidian-ai:chat-view";

export type ObsidianAICommandId =
  | "obsidian-ai:reindex-vault"
  | "obsidian-ai:index-changes"
  | "obsidian-ai:search-selection";

export const MVP_PROVIDER_IDS = ["openai", "ollama"] as const;
export type MVPProviderId = (typeof MVP_PROVIDER_IDS)[number];
export type ProviderId = MVPProviderId | (string & {});
export type ProviderKind = "embedding" | "chat";

export interface ChunkReference {
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  blockRef?: string;
  tags: string[];
}

export interface ChunkRecord {
  id: string;
  source: ChunkReference;
  content: string;
  hash: string;
  tokenEstimate?: number;
  updatedAt: number;
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
}

export interface EmbeddingResponse {
  providerId: ProviderId;
  model: string;
  vectors: EmbeddingVector[];
}

export interface EmbeddingProvider {
  readonly id: ProviderId;
  readonly name: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
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
}

export type JobType = "reindex-vault" | "index-changes" | "embed-batch" | "chat-completion";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

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
}

export interface RuntimeLoggerContract {
  log(event: RuntimeLogEvent): void;
}

export interface RuntimeServiceLifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ProviderRegistryContract extends RuntimeServiceLifecycle {
  getEmbeddingProviderId(): ProviderId;
  getChatProviderId(): ProviderId;
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
  reindexVault(): Promise<JobSnapshot>;
  indexChanges(): Promise<JobSnapshot>;
}

export interface RuntimeBootstrapContext {
  app: App;
  plugin: Plugin;
  getSettings: () => ObsidianAISettings;
  notify: (message: string) => void;
}

export interface RuntimeServices {
  indexingService: IndexingServiceContract;
  embeddingService: EmbeddingServiceContract;
  searchService: SearchServiceContract;
  chatService: ChatServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
  dispose(): Promise<void>;
}

export const RUNTIME_SERVICE_CONSTRUCTION_ORDER = [
  "providerRegistry",
  "embeddingService",
  "searchService",
  "agentService",
  "chatService",
  "indexingService"
] as const;

export type RuntimeServiceName = (typeof RUNTIME_SERVICE_CONSTRUCTION_ORDER)[number];

export interface RuntimeBootstrapResult {
  services: RuntimeServices;
  initializationOrder: RuntimeServiceName[];
}
