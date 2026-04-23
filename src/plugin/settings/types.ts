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
  /** Launch the sidecar with Node `--inspect` on port 62127 (see SidecarLifecycle). Reload plugin after changing. */
  sidecarInspector: boolean;
  transport: 'stdio' | 'http';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  searchResultCount: number;
  /** Phase-1 summary ANN limit (RET-4); persisted integer in [1, 256]. */
  chatCoarseK: number;
  /** Persona / tone for vault-only chat; empty = unset (CHAT-4). */
  chatSystemPrompt: string;
  /** Folder conventions, tags, daily-note patterns for retrieval intent (CHAT-4). */
  vaultOrganizationPrompt: string;
  /** Hybrid BM25 + vector coarse fusion (RET-5 / ADR-012); default on. */
  enableHybridSearch: boolean;
  /** BUG-3 / ADR-016: fallback civil date when IANA TZ is unavailable in the sidecar (−12..+14). */
  timezoneUtcOffsetHours: number;
  /** Globs for daily-note paths; used when indexing to populate `note_meta.note_date` (RET-6). */
  dailyNotePathGlobs: string[];
  /** Basename pattern for daily-note dates: `YYYY`, `MM`, `DD` tokens (RET-6). */
  dailyNoteDatePattern: string;
  matchedContentBudget: number;
  siblingContextBudget: number;
  parentSummaryBudget: number;
  queueConcurrency: number;
  maxRetries: number;
  embeddingDimension: number;
}
