import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import {
  INSUFFICIENT_EVIDENCE_STREAM_MESSAGE,
  type ChatWorkflowResult,
  runChatStream,
} from '@src/core/workflows/ChatWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

class CountingChat implements IChatPort {
  calls = 0;
  async *complete(): AsyncIterable<string> {
    this.calls += 1;
    yield '';
  }
}

class RecordingChat implements IChatPort {
  callCount = 0;
  lastCall: { messages: ChatMessage[]; context: string } | null = null;
  async *complete(
    messages: ChatMessage[],
    context: string,
    _key?: string,
    _opts?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.callCount += 1;
    this.lastCall = { messages, context };
    yield 'ok';
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<{ deltas: string[]; result: ChatWorkflowResult }> {
  const deltas: string[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      return { deltas, result: n.value };
    }
    deltas.push(n.value);
  }
}

describe('ChatWorkflow insufficient evidence (CHAT-3)', () => {
  it('B1_no_provider_call_on_zero_hits', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const chat = new CountingChat();
    await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(chat.calls).toBe(0);
  });

  it('B2_terminal_shape_marks_insufficient_evidence', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const chat = new CountingChat();
    const { result } = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result).toEqual({
      sources: [],
      groundingOutcome: 'insufficient_evidence',
      groundingPolicyVersion: 'v1',
    });
  });

  it('B3_answered_path_unchanged', async () => {
    const store = new SearchTestStore();
    const chat = new RecordingChat();
    const { result } = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(chat.callCount).toBe(1);
    expect(chat.lastCall?.context).toBe('');
    expect(chat.lastCall?.messages[0]?.role).toBe('system');
    expect(result.groundingOutcome).toBe('answered');
    expect(result.groundingPolicyVersion).toBe('v1');
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
  });

  it('B4_delta_includes_narrowing_hint', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const { deltas } = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), new CountingChat()), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    const text = deltas.join('').toLowerCase();
    expect(
      ['folder', 'tag', 'date', 'narrow'].some((k) => text.includes(k)),
    ).toBe(true);
    expect(deltas.join('')).toBe(INSUFFICIENT_EVIDENCE_STREAM_MESSAGE);
  });

  it('S5_followup_turn_remains_grounded', async () => {
    const hitStore = new SearchTestStore();
    const chatHit = new RecordingChat();
    const first = await drainChatStream(
      runChatStream(chatWorkflowDeps(hitStore, embed(), chatHit), [{ role: 'user', content: 'first' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(first.result.groundingOutcome).toBe('answered');

    const empty = new SearchTestStore();
    empty.summaryHits = [];
    empty.keywordHits = [];
    empty.contentHits = [];
    const chatMiss = new CountingChat();
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: first.deltas.join('') },
      { role: 'user', content: 'second' },
    ];
    const second = await drainChatStream(
      runChatStream(chatWorkflowDeps(empty, embed(), chatMiss), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(chatMiss.calls).toBe(0);
    expect(second.result.groundingOutcome).toBe('insufficient_evidence');
  });
});
