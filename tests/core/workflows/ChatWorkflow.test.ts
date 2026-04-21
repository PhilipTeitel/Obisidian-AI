import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

class SpyEmbedder implements IEmbeddingPort {
  lastTexts: string[] = [];
  async embed(texts: string[], _key?: string): Promise<Float32Array[]> {
    this.lastTexts = texts;
    return texts.map(() => new Float32Array(4).fill(0.5));
  }
}

class RecordingChatPort implements IChatPort {
  lastCall: {
    messages: ChatMessage[];
    context: string;
    apiKey?: string;
    options?: ChatCompletionOptions;
  } | null = null;
  chunks: string[] = ['hel', 'lo'];

  async *complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.lastCall = { messages, context, apiKey, options };
    for (const c of this.chunks) {
      yield c;
    }
  }
}

class NeverYieldChat implements IChatPort {
  async *complete(): AsyncIterable<string> {
    await new Promise<void>(() => {});
    yield 'x';
  }
}

class StallAfterFirstChat implements IChatPort {
  async *complete(): AsyncIterable<string> {
    yield 'only';
    await new Promise<void>(() => {});
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<{ deltas: string[]; result: ChatWorkflowResult }> {
  const deltas: string[] = [];
  while (true) {
    const n = await gen.next();
    if (n.done) {
      return { deltas, result: n.value };
    }
    deltas.push(n.value);
  }
}

describe('ChatWorkflow', () => {
  it('A1_uses_last_user_message', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const chat = new RecordingChatPort();
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: '  Q2  ' },
    ];
    const gen = runChatStream(chatWorkflowDeps(store, embedder, chat), messages, {
      search: DEFAULT_SEARCH_ASSEMBLY,
    });
    await drainChatStream(gen);
    expect(embedder.lastTexts).toEqual(['Q2']);
  });

  it('A2_no_user_message_fails', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const chat = new RecordingChatPort();
    const gen = runChatStream(
      chatWorkflowDeps(store, embedder, chat),
      [{ role: 'assistant', content: 'only assistant' }],
      { search: DEFAULT_SEARCH_ASSEMBLY },
    );
    await expect(drainChatStream(gen)).rejects.toThrow(/no user message/);
  });

  it('B1_context_passed_to_chat', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const chat = new RecordingChatPort();
    const messages: ChatMessage[] = [{ role: 'user', content: 'q' }];
    const gen = runChatStream(chatWorkflowDeps(store, embedder, chat), messages, {
      search: DEFAULT_SEARCH_ASSEMBLY,
    });
    await drainChatStream(gen);
    expect(chat.lastCall?.context).toBe('');
    expect(chat.lastCall?.messages[0]?.role).toBe('system');
    expect(chat.lastCall?.messages[0]?.content).toContain('[grounding_policy_version=v1]');
    const vaultCtx = chat.lastCall?.messages.find((m) => m.content.includes('**Matched content:**'));
    expect(vaultCtx?.role).toBe('system');
  });

  it('B2_streams_deltas', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const chat = new RecordingChatPort();
    const gen = runChatStream(chatWorkflowDeps(store, embedder, chat), [{ role: 'user', content: 'q' }], {
      search: DEFAULT_SEARCH_ASSEMBLY,
    });
    const { deltas } = await drainChatStream(gen);
    expect(deltas).toEqual(['hel', 'lo']);
  });

  it('B1_timeout_stops_stream', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const chat = new NeverYieldChat();
    const gen = runChatStream(chatWorkflowDeps(store, embedder, chat), [{ role: 'user', content: 'q' }], {
      search: DEFAULT_SEARCH_ASSEMBLY,
      completion: { timeoutMs: 150 },
    });
    const { deltas, result } = await drainChatStream(gen);
    expect(deltas).toEqual([]);
    expect(result.sources).toHaveLength(1);
    expect(result.groundingOutcome).toBe('answered');
  });

  it('C1_abort_stops_deltas', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const ac = new AbortController();
    const chat = new StallAfterFirstChat();
    const gen = runChatStream(chatWorkflowDeps(store, embedder, chat), [{ role: 'user', content: 'q' }], {
      search: DEFAULT_SEARCH_ASSEMBLY,
      completion: { signal: ac.signal },
    });
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe('only');
    ac.abort();
    const second = await gen.next();
    expect(second.done).toBe(true);
    if (second.done) {
      expect(second.value.sources).toHaveLength(1);
      expect(second.value.groundingOutcome).toBe('answered');
    }
  });

  it('C1_sources_aligned', async () => {
    const store = new SearchTestStore();
    const embedder = new SpyEmbedder();
    const chat = new RecordingChatPort();
    const gen = runChatStream(chatWorkflowDeps(store, embedder, chat), [{ role: 'user', content: 'q' }], {
      search: DEFAULT_SEARCH_ASSEMBLY,
    });
    const { result } = await drainChatStream(gen);
    expect(result.sources).toHaveLength(1);
    expect(result.groundingOutcome).toBe('answered');
    expect(result.sources[0]).toMatchObject({
      notePath: 'proj/plan.md',
      nodeId: 'leaf',
    });
  });
});
