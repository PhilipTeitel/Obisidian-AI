import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { DocumentNode } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { SearchTestStore } from './searchTestStore.js';

function seedNode(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'paragraph',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'body',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

describe('SearchWorkflow.sources filter parity (BUG-1)', () => {
  it('B1_path_glob_filter_excludes', async () => {
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set('d1', seedNode({ id: 'd1', noteId: 'nd', content: 'daily hit' }));
    store.nodes.set('p1', seedNode({ id: 'p1', noteId: 'np', content: 'proj hit' }));
    store.meta.set('nd', {
      noteId: 'nd',
      vaultPath: 'daily/2026-04-21.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    store.meta.set('np', {
      noteId: 'np',
      vaultPath: 'projects/pitch.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    store.summaryHits = [
      { nodeId: 'd1', score: 0.1 },
      { nodeId: 'p1', score: 0.09 },
    ];
    store.contentHits = [
      { nodeId: 'd1', score: 0.05 },
      { nodeId: 'p1', score: 0.04 },
    ];
    store.keywordHits = [];

    const res = await runSearch(
      { store, embedder: embed() },
      {
        query: 'q',
        k: 10,
        pathGlobs: ['daily/**'],
        enableHybridSearch: false,
      },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    expect(res.results.map((r) => r.notePath)).toEqual(['daily/2026-04-21.md']);
  });

  it('B2_date_range_filter_excludes', async () => {
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set('old', seedNode({ id: 'old', noteId: 'nold', content: 'old' }));
    store.nodes.set('new', seedNode({ id: 'new', noteId: 'nnew', content: 'new' }));
    store.meta.set('nold', {
      noteId: 'nold',
      vaultPath: 'daily/old.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-02-14',
    });
    store.meta.set('nnew', {
      noteId: 'nnew',
      vaultPath: 'daily/new.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-04-01',
    });
    store.summaryHits = [
      { nodeId: 'old', score: 0.1 },
      { nodeId: 'new', score: 0.09 },
    ];
    store.contentHits = [
      { nodeId: 'old', score: 0.05 },
      { nodeId: 'new', score: 0.04 },
    ];
    store.keywordHits = [];

    const res = await runSearch(
      { store, embedder: embed() },
      {
        query: 'q',
        k: 10,
        dateRange: { start: '2026-03-16', end: '2026-04-21' },
        enableHybridSearch: false,
      },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    expect(res.results.map((r) => r.notePath)).toEqual(['daily/new.md']);
  });

  it('B3_tags_filter_excludes', async () => {
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set('t1', seedNode({ id: 't1', noteId: 'nt1', content: 'tagged' }));
    store.nodes.set('t2', seedNode({ id: 't2', noteId: 'nt2', content: 'not' }));
    store.meta.set('nt1', {
      noteId: 'nt1',
      vaultPath: 'a.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    store.meta.set('nt2', {
      noteId: 'nt2',
      vaultPath: 'b.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    store.tagFilterByNoteId.set('nt2', false);
    store.summaryHits = [
      { nodeId: 't1', score: 0.1 },
      { nodeId: 't2', score: 0.09 },
    ];
    store.contentHits = [
      { nodeId: 't1', score: 0.05 },
      { nodeId: 't2', score: 0.04 },
    ];
    store.keywordHits = [];

    const res = await runSearch(
      { store, embedder: embed() },
      {
        query: 'q',
        k: 10,
        tags: ['jobhunt'],
        enableHybridSearch: false,
      },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    expect(res.results.map((r) => r.notePath)).toEqual(['a.md']);
  });
});
