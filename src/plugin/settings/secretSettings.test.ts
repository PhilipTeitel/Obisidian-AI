import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { getOpenAIApiKey, OPENAI_SECRET_ID } from './secretSettings.js';

describe('secretSettings', () => {
  it('A1_uses_loadSecret', () => {
    const getSecret = vi.fn().mockReturnValue('sk-test');
    const app = { secretStorage: { getSecret } } as unknown as App;
    expect(getOpenAIApiKey(app)).toBe('sk-test');
    expect(getSecret).toHaveBeenCalledWith(OPENAI_SECRET_ID);
  });
});
