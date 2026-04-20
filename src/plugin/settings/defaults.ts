import type { ObsidianAISettings } from './types.js';
import { DEFAULT_CHAT_COARSE_K } from './chatCoarseK.js';

export const DEFAULT_SETTINGS: ObsidianAISettings = {
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  embeddingBaseUrl: 'https://api.openai.com/v1',
  chatProvider: 'openai',
  chatModel: 'gpt-4o-mini',
  chatBaseUrl: 'https://api.openai.com/v1',
  chatTimeout: 30_000,
  indexedFolders: [],
  excludedFolders: [],
  agentOutputFolders: ['AI-Generated'],
  maxGeneratedNoteSize: 5000,
  dbPath: '',
  nodeExecutablePath: '',
  sidecarInspector: false,
  transport: 'stdio',
  logLevel: 'info',
  searchResultCount: 20,
  chatCoarseK: DEFAULT_CHAT_COARSE_K,
  matchedContentBudget: 0.6,
  siblingContextBudget: 0.25,
  parentSummaryBudget: 0.15,
  queueConcurrency: 1,
  maxRetries: 3,
  embeddingDimension: 1536,
};
