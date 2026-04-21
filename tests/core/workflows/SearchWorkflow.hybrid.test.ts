import { describe, expect, it } from 'vitest';
import { compilePathGlobs } from '@src/core/domain/pathGlob.js';
import type { VectorMatch } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { SearchTestStore } from './searchTestStore.js';

function fakeEmbed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

describe('SearchWorkflow hybrid (RET-5)', () => {
  it('C1_hybrid_on_issues_both_legs_and_fuses', async () => {
    const store = new SearchTestStore();
    const vhits: VectorMatch[] = Array.from({ length: 12 }, (_, i) => ({
      nodeId: `v${i}`,
      score: i * 0.01,
    }));
    store.summaryHits = vhits;
    store.keywordHits = vhits.map((h) => ({ ...h, score: h.score + 0.001 }));
    for (const h of vhits) {
      store.nodes.set(h.nodeId, {
        id: h.nodeId,
        noteId: 'n1',
        parentId: null,
        type: 'topic',
        headingTrail: [],
        depth: 0,
        siblingOrder: 0,
        content: '',
        contentHash: 'h',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', coarseK: 8, enableHybridSearch: true });
    expect(store.callLog).toContain('searchSummaryVectors');
    expect(store.callLog).toContain('searchContentKeyword');
    const firstPhase2 = store.callLog.indexOf('searchContentVectors');
    expect(store.callLog.indexOf('searchSummaryVectors')).toBeLessThan(firstPhase2);
    expect(store.callLog.indexOf('searchContentKeyword')).toBeLessThan(firstPhase2);
  });

  it('C2_hybrid_off_vector_only_no_bm25', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', enableHybridSearch: false });
    expect(store.callLog.filter((c) => c === 'searchContentKeyword')).toHaveLength(0);
    expect(store.callLog).toContain('searchSummaryVectors');
  });

  it('C3_bm25_restricted_to_summary_types', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', coarseK: 4, enableHybridSearch: true });
    expect(store.lastKeywordFilter?.nodeTypes).toEqual(['note', 'topic', 'subtopic']);
    const phase2 = store.contentFilters.find((f) => (f?.subtreeRootNodeIds?.length ?? 0) > 0);
    expect(phase2?.nodeTypes).toBeUndefined();
  });

  it('C4_exact_keyword_recovered_by_bm25', async () => {
    const store = new SearchTestStore();
    const kwOnly = 'kw-root';
    const vecOrder = Array.from({ length: 10 }, (_, i) => ({
      nodeId: `v${i}`,
      score: i * 0.01,
    }));
    store.summaryHits = vecOrder;
    store.keywordHits = [{ nodeId: kwOnly, score: 0.01 }, ...vecOrder.map((v) => ({ ...v }))];
    store.nodes.set(kwOnly, {
      id: kwOnly,
      noteId: 'nk',
      parentId: null,
      type: 'note',
      headingTrail: [],
      depth: 0,
      siblingOrder: 0,
      content: 'Acme Corp',
      contentHash: 'h',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    store.meta.set('nk', {
      noteId: 'nk',
      vaultPath: 'kw.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    for (const h of vecOrder) {
      if (!store.nodes.has(h.nodeId)) {
        store.nodes.set(h.nodeId, {
          id: h.nodeId,
          noteId: 'n1',
          parentId: null,
          type: 'topic',
          headingTrail: [],
          depth: 0,
          siblingOrder: 0,
          content: 'x',
          contentHash: 'h',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
      }
    }
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'Acme Corp', coarseK: 8, enableHybridSearch: true });
    const subtree = store.contentFilters.find((f) => (f?.subtreeRootNodeIds?.length ?? 0) > 0);
    expect(subtree?.subtreeRootNodeIds).toContain(kwOnly);
  });

  it('C5_fallback_preserves_user_filters', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    const embedder = fakeEmbed();
    await runSearch(
      { store, embedder },
      {
        query: 'q',
        coarseK: 32,
        enableHybridSearch: true,
        pathGlobs: ['Daily/*.md'],
        dateRange: { start: '2026-02-01', end: '2026-02-28' },
      },
    );
    const fallback = store.contentFilters.find((f) => !f?.subtreeRootNodeIds?.length);
    const compiled = compilePathGlobs(['Daily/*.md']);
    expect(fallback?.pathRegex).toBe(compiled.pathRegex);
    expect(fallback?.pathLikes).toEqual(compiled.pathLikes);
    expect(fallback?.dateRange).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('C6_empty_after_filters_routes_to_grounding', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'nothing', enableHybridSearch: true });
    expect(res.results).toEqual([]);
  });
});
