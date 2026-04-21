import { describe, expect, it } from 'vitest';
import { compilePathGlobs } from '@src/core/domain/pathGlob.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

function fakeEmbed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<ChatWorkflowResult> {
  let out: ChatWorkflowResult | undefined;
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      out = n.value;
      break;
    }
  }
  return out!;
}

describe('SearchWorkflow filters (RET-6)', () => {
  it('C1_propagation_phase1_phase2', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    const compiled = compilePathGlobs(['Daily/**/*.md']);
    await runSearch(
      { store, embedder },
      {
        query: 'q',
        coarseK: 8,
        enableHybridSearch: true,
        pathGlobs: ['Daily/**/*.md'],
        dateRange: { start: '2026-02-01', end: '2026-02-28' },
      },
    );
    expect(store.lastSummaryFilter?.pathRegex).toBe(compiled.pathRegex);
    expect(store.lastSummaryFilter?.dateRange).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
    const phase2 = store.contentFilters.find((f) => (f?.subtreeRootNodeIds?.length ?? 0) > 0);
    expect(phase2?.pathRegex).toBe(compiled.pathRegex);
    expect(phase2?.dateRange).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('C2_fallback_keeps_filters', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    const embedder = fakeEmbed();
    const compiled = compilePathGlobs(['Journal/**/*.md']);
    await runSearch(
      { store, embedder },
      {
        query: 'q',
        coarseK: 32,
        enableHybridSearch: true,
        pathGlobs: ['Journal/**/*.md'],
      },
    );
    const fallback = store.contentFilters.find((f) => !f?.subtreeRootNodeIds?.length);
    expect(fallback?.pathRegex).toBe(compiled.pathRegex);
  });

  it('C3_empty_after_filters_triggers_ie', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const embedder = fakeEmbed();
    const res = await runSearch(
      { store, embedder },
      {
        query: 'nothing',
        enableHybridSearch: true,
        pathGlobs: ['Daily/**/*.md'],
      },
    );
    expect(res.results).toEqual([]);
    let completeCalls = 0;
    const chat: IChatPort = {
      async *complete() {
        completeCalls += 1;
        yield '';
      },
    };
    const wfResult = await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store, embedder, chat),
        [{ role: 'user', content: 'nothing' }] as ChatMessage[],
        { pathGlobs: ['Daily/**/*.md'] },
      ),
    );
    expect(completeCalls).toBe(0);
    expect(wfResult.groundingOutcome).toBe('insufficient_evidence');
  });
});
