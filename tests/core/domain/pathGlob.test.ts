import { describe, expect, it } from 'vitest';
import { compilePathGlob } from '@src/core/domain/pathGlob.js';

describe('pathGlob (RET-6)', () => {
  it('A1_daily_glob', () => {
    const { regex, like } = compilePathGlob('Daily/**/*.md');
    expect(like).toContain('Daily');
    const re = new RegExp(regex);
    expect(re.test('Daily/2026-04-16.md')).toBe(true);
    expect(re.test('Daily/sub/2026-04-16.md')).toBe(true);
    expect(re.test('Other/notes.md')).toBe(false);
    expect(re.test('Daily/2026-04-16.txt')).toBe(false);
  });
});
