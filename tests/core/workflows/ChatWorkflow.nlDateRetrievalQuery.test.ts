import { describe, expect, it } from 'vitest';
import type { ResolverClock } from '@src/core/domain/dateRangeResolver.js';
import { resolveDateRangeFromPrompt } from '@src/core/domain/dateRangeResolver.js';
import { stripMatchedNLDatePhraseForRetrieval } from '@src/core/workflows/ChatWorkflow.js';

function clockAt(isoUtc: string): ResolverClock {
  return {
    now: () => new Date(isoUtc),
    timeZone: () => 'UTC',
  };
}

describe('ChatWorkflow NL date phrase stripped from retrieval query (REQ-006)', () => {
  it('from_iso_onwards_sentence_keeps_topic_words', () => {
    const q = 'What are the job search activities from 2026-04-15 onwards';
    const match = resolveDateRangeFromPrompt(q, clockAt('2026-04-21T12:00:00.000Z'), {
      utcOffsetHoursFallback: 0,
    });
    expect(match).not.toBeNull();
    expect(stripMatchedNLDatePhraseForRetrieval(q, match)).toBe('What are the job search activities');
  });

  it('last_n_weeks_phrase_removed', () => {
    const q = 'List job search activities over the last 2 weeks';
    const match = resolveDateRangeFromPrompt(q, clockAt('2026-04-21T15:00:00.000Z'), {
      utcOffsetHoursFallback: 0,
    });
    expect(match?.matchRuleId).toBe('last_n_weeks');
    expect(stripMatchedNLDatePhraseForRetrieval(q, match)).toBe('List job search activities over the');
  });

  it('no_match_returns_original', () => {
    const q = 'hello world no dates here';
    expect(stripMatchedNLDatePhraseForRetrieval(q, null)).toBe(q);
  });
});
