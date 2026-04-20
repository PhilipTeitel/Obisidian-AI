import { describe, expect, it } from 'vitest';
import { sanitizeFtsQuery } from '@src/core/domain/fts-sanitize.js';

describe('fts-sanitize (RET-5)', () => {
  it('sanitize_operator_chars', () => {
    const inputs = ['foo"bar', 'a*b', 'a(b)', 'a:b', 'a-b', 'a^b', 'mix*"():-^end'];
    for (const raw of inputs) {
      const s = sanitizeFtsQuery(raw);
      expect(s).not.toMatch(/["*():\-^]/);
      expect(s.length).toBeGreaterThan(0);
    }
    expect(sanitizeFtsQuery('  hello   world  ')).toBe('hello world');
  });
});
