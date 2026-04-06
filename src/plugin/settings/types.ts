/**
 * Persisted plugin settings (README Plugin Settings). Secrets use {@link App.secretStorage}, not this object.
 */
export interface ObsidianAISettings {
  embeddingProvider: 'openai' | 'ollama';
  embeddingModel: string;
  embeddingBaseUrl: string;
  chatProvider: 'openai' | 'ollama';
  chatModel: string;
  chatBaseUrl: string;
  chatTimeout: number;
  indexedFolders: string[];
  excludedFolders: string[];
  agentOutputFolders: string[];
  maxGeneratedNoteSize: number;
  dbPath: string;
  transport: 'stdio' | 'http';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  searchResultCount: number;
  matchedContentBudget: number;
  siblingContextBudget: number;
  parentSummaryBudget: number;
  queueConcurrency: number;
  maxRetries: number;
  embeddingDimension: number;
}
