import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';

describe('DEFAULT_SETTINGS', () => {
  it('A1_readme_defaults', () => {
    expect(DEFAULT_SETTINGS.embeddingModel).toBe('text-embedding-3-small');
    expect(DEFAULT_SETTINGS.chatModel).toBe('gpt-4o-mini');
    expect(DEFAULT_SETTINGS.chatTimeout).toBe(30_000);
    expect(DEFAULT_SETTINGS.searchResultCount).toBe(20);
    expect(DEFAULT_SETTINGS.chatCoarseK).toBe(32);
    expect(DEFAULT_SETTINGS.enableHybridSearch).toBe(true);
    expect(DEFAULT_SETTINGS.dailyNotePathGlobs).toEqual(['Daily/**/*.md']);
    expect(DEFAULT_SETTINGS.dailyNoteDatePattern).toBe('YYYY-MM-DD');
    expect(DEFAULT_SETTINGS.embeddingDimension).toBe(1536);
    expect(DEFAULT_SETTINGS.sidecarInspector).toBe(false);
    expect(DEFAULT_SETTINGS.transport).toBe('stdio');
    expect(DEFAULT_SETTINGS.chatSystemPrompt).toBe('');
    expect(DEFAULT_SETTINGS.vaultOrganizationPrompt).toBe('');
  });
});
