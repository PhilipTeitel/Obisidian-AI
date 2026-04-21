import { validateSearchAssemblyOptions } from '../../core/domain/contextAssembly.js';
import type { SearchAssemblyOptions } from '../../core/domain/types.js';
import type { ObsidianAISettings } from './types.js';

/** Build snippet assembly options from persisted plugin fractions (RET-2 / RET-4). */
export function buildSearchAssemblyFromSettings(s: ObsidianAISettings): SearchAssemblyOptions {
  const opts: SearchAssemblyOptions = {
    budget: {
      matchedContent: s.matchedContentBudget,
      siblingContext: s.siblingContextBudget,
      parentSummary: s.parentSummaryBudget,
    },
    totalTokenBudget: 1024,
  };
  validateSearchAssemblyOptions(opts);
  return opts;
}
