import { describe, expect, it } from 'vitest';
import { getCoreLabel } from './index.js';

describe('smoke', () => {
  it('health', () => {
    expect(getCoreLabel()).toBe('obsidian-ai-core');
  });
});
