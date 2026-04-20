import { describe, expect, it } from 'vitest';
import type { VectorMatch } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import {
  DEFAULT_COARSE_K,
  fallbackFloorForCoarseK,
  runSearch,
} from '@src/core/workflows/SearchWorkflow.js';
import { SearchTestStore } from './searchTestStore.js';

function fakeEmbed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

describe('SearchWorkflow coarse-K + fallback (RET-4)', () => {
  it('A1_respects_coarseK_S1_S2', async () => {
    const store = new SearchTestStore();
    const forty: VectorMatch[] = Array.from({ length: 40 }, (_, i) => ({
      nodeId: `s${i}`,
      score: i * 0.01,
    }));
    store.summaryHits = forty;
    for (const h of forty) {
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
    await runSearch({ store, embedder }, { query: 'q', coarseK: 25 });
    expect(store.lastSummaryK).toBe(25);
    const subtreeCalls = store.contentFilters.filter((f) => (f?.subtreeRootNodeIds?.length ?? 0) > 0);
    expect(subtreeCalls[0]?.subtreeRootNodeIds?.length).toBe(25);
  });

  it('A2_default_32_S6', async () => {
    const store = new SearchTestStore();
    let summaryK = 0;
    const embedder = fakeEmbed();
    const orig = store.searchSummaryVectors.bind(store);
    store.searchSummaryVectors = async (q, k) => {
      summaryK = k;
      return orig(q, k);
    };
    await runSearch({ store, embedder }, { query: 'q' });
    expect(summaryK).toBe(DEFAULT_COARSE_K);
  });

  it('B1_fallback_fires_below_floor_S3', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [
      { nodeId: 'a', score: 0.1 },
      { nodeId: 'b', score: 0.2 },
    ];
    const coarseK = 32;
    expect(store.summaryHits.length).toBeLessThan(fallbackFloorForCoarseK(coarseK));
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', coarseK });
    const unrestricted = store.contentFilters.some(
      (f) => !f?.subtreeRootNodeIds?.length,
    );
    expect(unrestricted).toBe(true);
  });

  it('B2_merge_dedup_S3', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [{ nodeId: 'root', score: 0.1 }];
    store.searchContentVectors = async (q, k, f) => {
      store.callLog.push('searchContentVectors');
      store.lastContentFilter = f;
      store.contentFilters.push(f);
      if (f?.subtreeRootNodeIds?.length) {
        return [{ nodeId: 'leaf', score: 0.04 }];
      }
      return [{ nodeId: 'leaf', score: 0.06 }];
    };
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'q', coarseK: 32 });
    const leafRows = res.results.filter((r) => r.nodeId === 'leaf');
    expect(leafRows).toHaveLength(1);
    expect(store.contentFilters.length).toBeGreaterThanOrEqual(2);
  });

  it('B3_coarse_empty_fallback_runs_S4_S8', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.contentHits = [];
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'q', coarseK: 32 });
    expect(res.results).toEqual([]);
    expect(store.callLog).toContain('searchContentVectors');
  });

  it('B4_above_floor_no_fallback_S9', async () => {
    const store = new SearchTestStore();
    const coarseK = 32;
    const floor = fallbackFloorForCoarseK(coarseK);
    const hits: VectorMatch[] = Array.from({ length: floor }, (_, i) => ({
      nodeId: `s${i}`,
      score: i * 0.01,
    }));
    store.summaryHits = hits;
    for (const h of hits) {
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
    await runSearch({ store, embedder }, { query: 'q', coarseK });
    const unrestrictedCalls = store.contentFilters.filter(
      (f) => f !== undefined && (!f.subtreeRootNodeIds || f.subtreeRootNodeIds.length === 0),
    ).length;
    expect(unrestrictedCalls).toBe(0);
  });

  it('B5_fallback_independent_of_hybrid_toggle_Y6', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [{ nodeId: 'r', score: 0.1 }];
    const embedder = fakeEmbed();
    const run = async (hybrid: boolean | undefined) => {
      store.callLog = [];
      store.contentFilters = [];
      await runSearch({ store, embedder }, { query: 'q', coarseK: 32, enableHybridSearch: hybrid });
      return [...store.callLog];
    };
    const a = await run(true);
    const b = await run(false);
    const c = await run(undefined);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
