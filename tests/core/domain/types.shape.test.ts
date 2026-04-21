import { describe, expect, it } from 'vitest';
import type { SearchRequest } from '@src/core/domain/types.js';
import type { ChatWorkflowOptions } from '@src/core/workflows/ChatWorkflow.js';

describe('types shape (RET-6 Y1)', () => {
  it('Y1_request_shape', () => {
    const s: SearchRequest = { query: 'q' };
    expect(s.pathGlobs).toBeUndefined();
    expect(s.dateRange).toBeUndefined();

    const s2: SearchRequest = {
      query: 'q',
      pathGlobs: ['a/**/*.md'],
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
    };
    expect(s2.pathGlobs?.[0]).toBe('a/**/*.md');
    expect(s2.dateRange?.start).toBe('2026-01-01');

    const c: ChatWorkflowOptions = {};
    expect(c.pathGlobs).toBeUndefined();
    const c2: ChatWorkflowOptions = { pathGlobs: ['x'], dateRange: { end: '2026-02-01' } };
    expect(c2.pathGlobs).toEqual(['x']);
  });
});
