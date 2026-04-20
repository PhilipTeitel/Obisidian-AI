import { describe, expect, it, vi } from 'vitest';
import { SNIPPET_HEADING_OVERHEAD_TOKENS } from '@src/core/domain/contextAssembly.js';
import { estimateTokens } from '@src/core/domain/tokenEstimator.js';
import type { DocumentNode } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { DEFAULT_SEARCH_K, mapSearchK, runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { SearchTestStore } from './searchTestStore.js';

function node(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: '',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function fakeEmbed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

describe('SearchWorkflow', () => {
  it('A1_single_embed_call', async () => {
    const store = new SearchTestStore();
    const embedder: IEmbeddingPort = {
      async embed(texts: string[], _key?: string) {
        return texts.map(() => new Float32Array(4).fill(0.5));
      },
    };
    const spy = vi.spyOn(embedder, 'embed');
    await runSearch({ store, embedder }, { query: '  hello world  ' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual(['hello world']);
  });

  it('A2_summary_before_content', async () => {
    const store = new SearchTestStore();
    store.summaryHits = Array.from({ length: 8 }, (_, i) => ({
      nodeId: `s${i}`,
      score: i * 0.01,
    }));
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', enableHybridSearch: false });
    expect(store.callLog).toEqual(['searchSummaryVectors', 'searchContentVectors']);
  });

  it('A3_no_coarse_triggers_fallback', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.contentHits = [];
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'q', enableHybridSearch: false });
    expect(res.results).toEqual([]);
    expect(store.callLog).toEqual(['searchSummaryVectors', 'searchContentVectors']);
  });

  it('B1_result_shape', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'q' });
    expect(res.results).toHaveLength(1);
    const r = res.results[0]!;
    expect(r.nodeId).toBe('leaf');
    expect(r.notePath).toBe('proj/plan.md');
    expect(typeof r.score).toBe('number');
    expect(r.snippet.length).toBeGreaterThan(0);
    expect(r.snippet).toContain('**Matched content:**');
    expect(r.snippet).toContain('**Sibling context:**');
    expect(r.snippet).toContain('**Parent summary:**');
    expect(r.headingTrail).toEqual(['Goals']);
  });

  it('B2_respects_k_cap', async () => {
    const store = new SearchTestStore();
    store.contentHits = [
      { nodeId: 'a', score: 0.01 },
      { nodeId: 'b', score: 0.02 },
      { nodeId: 'c', score: 0.03 },
    ];
    for (const id of ['a', 'b', 'c']) {
      store.nodes.set(
        id,
        node({
          id,
          noteId: 'n1',
          type: 'paragraph',
          content: `text-${id}`,
          headingTrail: [],
        }),
      );
    }
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'q', k: 2 });
    expect(res.results.length).toBeLessThanOrEqual(2);
  });

  it('mapSearchK_documented', () => {
    expect(mapSearchK(20, 32)).toEqual({ kSummary: 32, kContent: 20 });
    expect(mapSearchK(5, 8)).toEqual({ kSummary: 8, kContent: 5 });
  });

  it('default_k_uses_DEFAULT_SEARCH_K', async () => {
    const store = new SearchTestStore();
    const many = Array.from({ length: 25 }, (_, i) => ({
      nodeId: `n${i}`,
      score: i * 0.01,
    }));
    store.contentHits = many;
    for (const { nodeId } of many) {
      store.nodes.set(
        nodeId,
        node({
          id: nodeId,
          noteId: 'n1',
          type: 'paragraph',
          content: 'x',
        }),
      );
    }
    const embedder = fakeEmbed();
    const res = await runSearch({ store, embedder }, { query: 'q' });
    expect(res.results.length).toBe(DEFAULT_SEARCH_K);
  });

  it('A1_tags_forwarded', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', tags: ['foo'] });
    expect(store.lastContentFilter?.tagsAny).toEqual(['foo']);
  });

  it('passes_subtree_roots_from_summary_hits', async () => {
    const store = new SearchTestStore();
    store.summaryHits = Array.from({ length: 4 }, (_, i) => ({
      nodeId: `s${i}`,
      score: i * 0.01,
    }));
    const embedder = fakeEmbed();
    await runSearch({ store, embedder }, { query: 'q', coarseK: 16 });
    const phase2Filter = store.contentFilters.find((f) => (f?.subtreeRootNodeIds?.length ?? 0) > 0);
    expect(phase2Filter?.subtreeRootNodeIds).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('B2_snippet_within_budget', async () => {
    const store = new SearchTestStore();
    store.nodes.set(
      'leaf',
      node({
        id: 'leaf',
        noteId: 'n1',
        parentId: 'root',
        type: 'paragraph',
        depth: 1,
        headingTrail: ['Goals'],
        content: 'p'.repeat(8000),
      }),
    );
    const embedder = fakeEmbed();
    const assembly = {
      budget: { matchedContent: 0.6, siblingContext: 0.25, parentSummary: 0.15 },
      totalTokenBudget: 120,
    } as const;
    const res = await runSearch({ store, embedder }, { query: 'q' }, assembly);
    expect(res.results).toHaveLength(1);
    const tokens = estimateTokens(res.results[0]!.snippet);
    expect(tokens).toBeLessThanOrEqual(assembly.totalTokenBudget + SNIPPET_HEADING_OVERHEAD_TOKENS);
  });
});
