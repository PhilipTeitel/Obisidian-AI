import { describe, expect, it } from 'vitest';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

function fakeEmbed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

describe('ChatWorkflow hybrid (RET-5)', () => {
  it('C7_chat_shares_retrieval_helper_and_toggle', async () => {
    const store = new SearchTestStore();
    const embedder = fakeEmbed();
    const noopChat: IChatPort = {
      async *complete() {
        yield '';
      },
    };
    const gen = runChatStream(
      chatWorkflowDeps(store, embedder, noopChat),
      [{ role: 'user', content: 'hello' }],
      { enableHybridSearch: true, coarseK: 8 },
    );
    for (;;) {
      const step = await gen.next();
      if (step.done) break;
    }
    expect(store.callLog).toContain('searchContentKeyword');
    expect(store.callLog).toContain('searchSummaryVectors');
  });
});
