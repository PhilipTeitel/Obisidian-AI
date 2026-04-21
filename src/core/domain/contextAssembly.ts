import { estimateTokens } from './tokenEstimator.js';
import type { SearchAssemblyOptions } from './types.js';

const SUM_TOLERANCE = 1e-6;

/** README §10 defaults until the sidecar passes plugin settings (RET-2). */
export const DEFAULT_SEARCH_ASSEMBLY: SearchAssemblyOptions = {
  budget: {
    matchedContent: 0.6,
    siblingContext: 0.25,
    parentSummary: 0.15,
  },
  totalTokenBudget: 1024,
};

export function validateSearchAssemblyOptions(opts: SearchAssemblyOptions): void {
  const { budget, totalTokenBudget } = opts;
  if (totalTokenBudget <= 0 || !Number.isFinite(totalTokenBudget)) {
    throw new Error('SearchAssemblyOptions.totalTokenBudget must be a positive finite number');
  }
  const { matchedContent, siblingContext, parentSummary } = budget;
  for (const x of [matchedContent, siblingContext, parentSummary]) {
    if (x < 0 || !Number.isFinite(x)) {
      throw new Error('Context budget fractions must be non-negative finite numbers');
    }
  }
  const sum = matchedContent + siblingContext + parentSummary;
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    throw new Error(`Context budget fractions must sum to 1.0 (±${SUM_TOLERANCE}), got ${sum}`);
  }
}

function truncateToMaxTokens(text: string, maxTokens: number): string {
  if (text.length === 0) return text;
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.max(0, maxTokens * 4 - 1);
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

function noteTitleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '') || base;
}

export interface AssembleSnippetInput {
  vaultPath: string;
  headingTrail: string[];
  matchedText: string;
  siblingText: string;
  parentSummaryText: string;
  assembly: SearchAssemblyOptions;
}

/**
 * Build the search/chat structured snippet (README §10) with per-tier token caps.
 */
export function assembleSearchSnippet(input: AssembleSnippetInput): string {
  validateSearchAssemblyOptions(input.assembly);
  const { budget, totalTokenBudget } = input.assembly;
  const maxMatched = Math.max(0, Math.floor(totalTokenBudget * budget.matchedContent));
  const maxSib = Math.max(0, Math.floor(totalTokenBudget * budget.siblingContext));
  const maxParent = Math.max(0, Math.floor(totalTokenBudget * budget.parentSummary));

  const raw = input.matchedText.trim() ? input.matchedText : '(empty)';
  const matchedBlock = truncateToMaxTokens(raw, maxMatched);
  const siblingBlock = truncateToMaxTokens(input.siblingText, maxSib);
  const parentBlock = truncateToMaxTokens(input.parentSummaryText, maxParent);

  const title = noteTitleFromPath(input.vaultPath);
  const trail = input.headingTrail.length > 0 ? input.headingTrail.join(' > ') : '(root)';

  return [
    `## Note: "${title}" (${input.vaultPath})`,
    `### Section: ${trail}`,
    '',
    '**Matched content:**',
    matchedBlock,
    '',
    '**Sibling context:**',
    siblingBlock,
    '',
    '**Parent summary:**',
    parentBlock,
  ].join('\n');
}

/** Rough ceiling for fixed heading/label lines in `assembleSearchSnippet` (for tests). */
export const SNIPPET_HEADING_OVERHEAD_TOKENS = 80;
