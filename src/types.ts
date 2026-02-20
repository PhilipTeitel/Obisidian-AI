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
