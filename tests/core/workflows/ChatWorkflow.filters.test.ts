import { describe, expect, it } from 'vitest';
import { compilePathGlobs } from '@src/core/domain/pathGlob.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
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

describe('ChatWorkflow filters (RET-6)', () => {
  it('C4_forwards_filters', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    const compiled = compilePathGlobs(['Work/**/*.md']);
    const filterReq = {
      query: 'hello',
      pathGlobs: ['Work/**/*.md'] as string[],
      dateRange: { start: '2026-03-01', end: '2026-03-15' },
      coarseK: 16,
      k: 10,
      enableHybridSearch: true,
    };
    await runSearch({ store, embedder }, filterReq, DEFAULT_SEARCH_ASSEMBLY);
    const searchSummary = store.lastSummaryFilter;
    const chatStore = new SearchTestStore();
    const chat: IChatPort = {
      async *complete(): AsyncIterable<string> {
        yield '';
      },
    };
    await drainChatStream(
      runChatStream(
        { store: chatStore, embedder, chat },
        [{ role: 'user', content: 'hello' }] as ChatMessage[],
        {
          search: DEFAULT_SEARCH_ASSEMBLY,
          pathGlobs: filterReq.pathGlobs,
          dateRange: filterReq.dateRange,
          coarseK: filterReq.coarseK,
          k: filterReq.k,
          enableHybridSearch: true,
        },
      ),
    );
    expect(chatStore.lastSummaryFilter?.pathRegex).toBe(compiled.pathRegex);
    expect(chatStore.lastSummaryFilter?.dateRange).toEqual(filterReq.dateRange);
    expect(searchSummary?.pathRegex).toBe(compiled.pathRegex);
    expect(searchSummary?.dateRange).toEqual(filterReq.dateRange);
  });
});
