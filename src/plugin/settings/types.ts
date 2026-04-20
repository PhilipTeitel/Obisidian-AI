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
  /** Absolute path to the `node` binary for the sidecar. Empty = auto-detect (often fails when Obsidian starts from the Dock). */
  nodeExecutablePath: string;
  /** Launch the sidecar with `--inspect=0` so a Node debugger can attach. Reload plugin after changing. */
  sidecarInspector: boolean;
  transport: 'stdio' | 'http';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  searchResultCount: number;
  /** Phase-1 summary ANN limit (RET-4); persisted integer in [1, 256]. */
  chatCoarseK: number;
  matchedContentBudget: number;
  siblingContextBudget: number;
  parentSummaryBudget: number;
  queueConcurrency: number;
  maxRetries: number;
  embeddingDimension: number;
}
