import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults.js';

describe('DEFAULT_SETTINGS', () => {
  it('A1_readme_defaults', () => {
    expect(DEFAULT_SETTINGS.embeddingModel).toBe('text-embedding-3-small');
    expect(DEFAULT_SETTINGS.chatModel).toBe('gpt-4o-mini');
    expect(DEFAULT_SETTINGS.chatTimeout).toBe(30_000);
    expect(DEFAULT_SETTINGS.searchResultCount).toBe(20);
    expect(DEFAULT_SETTINGS.embeddingDimension).toBe(1536);
    expect(DEFAULT_SETTINGS.transport).toBe('stdio');
  });
});
