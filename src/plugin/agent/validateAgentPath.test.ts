import { describe, expect, it } from 'vitest';
import { validateAgentPath } from './validateAgentPath.js';

describe('validateAgentPath', () => {
  it('rejects parent traversal segments', () => {
    expect(validateAgentPath('../secret.md', ['AI-Generated'])).toBeTruthy();
    expect(validateAgentPath('AI-Generated/../../etc.md', ['AI-Generated'])).toBeTruthy();
  });

  it('rejects paths outside allowed roots', () => {
    expect(validateAgentPath('Notes/foo.md', ['AI-Generated'])).toBeTruthy();
    expect(validateAgentPath('AI-Generated/x.md', ['AI-Generated'])).toBeNull();
    expect(validateAgentPath('AI-Generated/sub/x.md', ['AI-Generated'])).toBeNull();
  });

  it('rejects when no roots configured', () => {
    expect(validateAgentPath('x.md', [])).toBeTruthy();
    expect(validateAgentPath('x.md', ['  ', ''])).toBeTruthy();
  });
});
