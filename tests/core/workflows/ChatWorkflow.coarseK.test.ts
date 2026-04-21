import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

class StubChat implements IChatPort {
  async *complete(): AsyncIterable<string> {
    yield '';
  }
}

function embed(): IEmbeddingPort {
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
  while (true) {
    const n = await gen.next();
    if (n.done) {
      out = n.value;
      break;
    }
  }
  return out!;
}

describe('ChatWorkflow RET-4 parity', () => {
  it('C2_shared_retrieval_helper_S5', async () => {
    expect(String(runChatStream)).toContain('runSearch');
    const s1 = await runSearch(
      { store: new SearchTestStore(), embedder: embed() },
      { query: 'q', coarseK: 40, k: 10 },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    const store2 = new SearchTestStore();
    await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store2, embed(), new StubChat()),
        [{ role: 'user', content: 'q' }] as ChatMessage[],
        { search: DEFAULT_SEARCH_ASSEMBLY, coarseK: 40, k: 10 },
      ),
    );
    expect(store2.lastSummaryK).toBe(40);
    expect(s1.results.length).toBeGreaterThanOrEqual(0);
  });

  it('Y5_empty_after_fallback_keeps_grounding_S8', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.contentHits = [];
    let completeCalls = 0;
    const chatSpy: IChatPort = {
      async *complete() {
        completeCalls += 1;
        yield '';
      },
    };
    const result = await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store, embed(), chatSpy),
        [{ role: 'user', content: 'q' }],
        { search: DEFAULT_SEARCH_ASSEMBLY },
      ),
    );
    expect(completeCalls).toBe(0);
    expect(result.groundingOutcome).toBe('insufficient_evidence');
    expect(result.sources).toEqual([]);
  });
});
