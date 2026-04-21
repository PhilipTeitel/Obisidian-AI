import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { buildGroundedMessages } from '@src/sidecar/adapters/chatProviderMessages.js';
import { chatWorkflowDeps } from './chatWorkflowDeps.js';
import { SearchTestStore } from '../core/workflows/searchTestStore.js';

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

class CaptureChat implements IChatPort {
  lastCall: { messages: ChatMessage[]; context: string } | null = null;
  async *complete(
    messages: ChatMessage[],
    context: string,
    _key?: string,
    _opts?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.lastCall = { messages, context };
    yield '';
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<ChatWorkflowResult> {
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      return n.value;
    }
  }
}

describe('ChatWorkflow grounded provider integration (CHAT-3)', () => {
  it('Y7_workflow_passes_full_message_list_to_real_port', async () => {
    const store = new SearchTestStore();
    const e = embed();
    const searchRes = await runSearch(
      { store, embedder: e },
      { query: 'q', k: 10, coarseK: 32 },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    const context = searchRes.results.map((r) => r.snippet).join('\n\n---\n\n');
    const messages: ChatMessage[] = [{ role: 'user', content: 'q' }];
    const expected = buildGroundedMessages(messages, {
      retrievalContext: context,
      vaultOrganizationPrompt: 'daily notes live under Daily/',
      systemPrompt: 'Be concise.',
    });

    const chat = new CaptureChat();
    await drainChatStream(
      runChatStream(chatWorkflowDeps(store, e, chat), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
        vaultOrganizationPrompt: 'daily notes live under Daily/',
        systemPrompt: 'Be concise.',
      }),
    );

    expect(chat.lastCall?.context).toBe('');
    expect(chat.lastCall?.messages).toEqual(expected);
  });
});
