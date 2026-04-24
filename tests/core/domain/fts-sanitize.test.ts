import { describe, expect, it } from 'vitest';
import { buildFtsMatchQuery, DEFAULT_FTS_MATCH_MAX_TERMS } from '@src/core/domain/fts-sanitize.js';

describe('buildFtsMatchQuery (BUG-4 / ADR-017)', () => {
  it('A1_basic_tokens_or_joined', () => {
    expect(buildFtsMatchQuery('pros cons')).toBe('"pros" OR "cons"');
  });

  it('A2_punctuation_stripped', () => {
    expect(buildFtsMatchQuery('What happened last month?')).toBe(
      '"what" OR "happened" OR "last" OR "month"',
    );
  });

  it('A3_backticks_stripped', () => {
    expect(buildFtsMatchQuery('use the `foo` command')).toBe(
      '"use" OR "the" OR "foo" OR "command"',
    );
  });

  it('A4_reserved_keywords_dropped', () => {
    expect(buildFtsMatchQuery('pros and cons')).toBe('"pros" OR "cons"');
    expect(buildFtsMatchQuery('a OR b')).toBe('"a" OR "b"');
    expect(buildFtsMatchQuery('NOT a NEAR b')).toBe('"a" OR "b"');
    expect(buildFtsMatchQuery('AND OR NOT NEAR')).toBeNull();
  });

  it('A5_zero_tokens_returns_null', () => {
    expect(buildFtsMatchQuery('??!!...')).toBeNull();
    expect(buildFtsMatchQuery('')).toBeNull();
    expect(buildFtsMatchQuery('   \t\n')).toBeNull();
  });

  it('A6_64_term_cap', () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    const raw = words.join(' ');
    const q = buildFtsMatchQuery(raw);
    expect(q).not.toBeNull();
    const phrases = q!.split(' OR ');
    expect(phrases).toHaveLength(DEFAULT_FTS_MATCH_MAX_TERMS);
    expect(phrases.every((p) => /^"w\d+"$/.test(p))).toBe(true);
  });
});
