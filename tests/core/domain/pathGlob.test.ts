import { describe, expect, it } from 'vitest';
import {
  compilePathGlob,
  vaultPathMatchesAnyGlob,
  VAULT_PATH_GLOB_REGEX_FLAGS,
} from '@src/core/domain/pathGlob.js';

describe('pathGlob (RET-6)', () => {
  it('A1_daily_glob', () => {
    const { regex, like } = compilePathGlob('Daily/**/*.md');
    expect(like).toBe('Daily/%.md');
    const re = new RegExp(regex, VAULT_PATH_GLOB_REGEX_FLAGS);
    expect(re.test('Daily/2026-04-16.md')).toBe(true);
    expect(re.test('Daily/sub/2026-04-16.md')).toBe(true);
    expect(re.test('Other/notes.md')).toBe(false);
    expect(re.test('Daily/2026-04-16.txt')).toBe(false);
  });

  it('A2_vault_path_glob_case_insensitive_for_daily_vs_Daily', () => {
    const { regex } = compilePathGlob('Daily/**/*.md');
    const re = new RegExp(regex, VAULT_PATH_GLOB_REGEX_FLAGS);
    expect(re.test('daily/2026-04-16.md')).toBe(true);
    expect(vaultPathMatchesAnyGlob('daily/2026-04-16.md', ['Daily/**/*.md'])).toBe(true);
  });
});
