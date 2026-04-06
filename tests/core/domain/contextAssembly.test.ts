import { describe, expect, it } from 'vitest';
import {
  assembleSearchSnippet,
  DEFAULT_SEARCH_ASSEMBLY,
  validateSearchAssemblyOptions,
} from '@src/core/domain/contextAssembly.js';

describe('contextAssembly', () => {
  it('A1_rejects_bad_sum', () => {
    expect(() =>
      validateSearchAssemblyOptions({
        budget: {
          matchedContent: 0.33,
          siblingContext: 0.33,
          parentSummary: 0.33,
        },
        totalTokenBudget: 100,
      }),
    ).toThrow(/sum to 1\.0/);
  });

  it('A2_default_budget_ok', () => {
    expect(() => validateSearchAssemblyOptions(DEFAULT_SEARCH_ASSEMBLY)).not.toThrow();
    const out = assembleSearchSnippet({
      vaultPath: 'a/b.md',
      headingTrail: ['H'],
      matchedText: 'hello',
      siblingText: 'sib',
      parentSummaryText: 'par',
      assembly: DEFAULT_SEARCH_ASSEMBLY,
    });
    expect(out).toContain('**Matched content:**');
    expect(out).toContain('hello');
  });

  it('B1_matched_truncation_respects_share', () => {
    const assembly = {
      budget: { matchedContent: 0.6, siblingContext: 0.25, parentSummary: 0.15 },
      totalTokenBudget: 50,
    } as const;
    const long = 'x'.repeat(2000);
    const out = assembleSearchSnippet({
      vaultPath: 'n.md',
      headingTrail: [],
      matchedText: long,
      siblingText: long,
      parentSummaryText: long,
      assembly,
    });
    const m = out.match(/\*\*Matched content:\*\*\n([\s\S]*?)\n\n\*\*Sibling context:\*\*/);
    expect(m).toBeTruthy();
    const matchedSection = m![1]!.trimEnd();
    expect(matchedSection.length).toBeLessThan(500);
    expect(matchedSection.endsWith('…')).toBe(true);
    const s = out.match(/\*\*Sibling context:\*\*\n([\s\S]*?)\n\n\*\*Parent summary:\*\*/);
    expect(s![1]!.trimEnd().endsWith('…')).toBe(true);
  });
});
