import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

class CaptureChat implements IChatPort {
  calls: ChatMessage[][] = [];
  async *complete(
    messages: ChatMessage[],
    _context: string,
    _key?: string,
    _opts?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.calls.push([...messages]);
    yield '';
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<void> {
  for (;;) {
    const n = await gen.next();
    if (n.done) return;
  }
}

describe('ChatWorkflow user prompts (CHAT-4)', () => {
  it('B4_new_conversation_reset_still_includes_prompts', async () => {
    const store = new SearchTestStore();
    const e = embed();
    const chat = new CaptureChat();
    const opts = {
      search: DEFAULT_SEARCH_ASSEMBLY,
      vaultOrganizationPrompt: 'ORG',
      systemPrompt: 'SYS',
    };
    const messages: ChatMessage[] = [{ role: 'user', content: 'same-query' }];
    await drainChatStream(runChatStream(chatWorkflowDeps(store, e, chat), messages, opts));
    const first = chat.calls[0]!;
    chat.calls = [];
    await drainChatStream(runChatStream(chatWorkflowDeps(store, e, chat), messages, opts));
    const second = chat.calls[0]!;
    expect(first).toEqual(second);
    expect(first[0]?.content).toContain('[grounding_policy_version=v1]');
    expect(first[1]?.content).toBe('ORG');
    expect(first[2]?.content).toBe('SYS');
  });
});
