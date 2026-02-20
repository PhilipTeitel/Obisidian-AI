export type ObsidianAIViewType = "obsidian-ai:search-view" | "obsidian-ai:chat-view";

export type ObsidianAICommandId =
  | "obsidian-ai:reindex-vault"
  | "obsidian-ai:index-changes"
  | "obsidian-ai:search-selection";

export interface ObsidianAISettings {
  embeddingProvider: string;
  chatProvider: string;
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

export interface ProgressSlideoutStatus {
  label: string;
  detail: string;
  isActive: boolean;
}
