import { describe, expect, it } from 'vitest';
import { getCoreLabel } from '@src/core/index.js';

describe('smoke', () => {
  it('health', () => {
    expect(getCoreLabel()).toBe('obsidian-ai-core');
  });
});
