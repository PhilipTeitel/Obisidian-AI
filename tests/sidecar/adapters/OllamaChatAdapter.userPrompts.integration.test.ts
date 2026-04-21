import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@src/core/domain/types.js';
import { OllamaChatAdapter } from '@src/sidecar/adapters/OllamaChatAdapter.js';
import {
  GROUNDING_POLICY_V1,
  VAULT_CONTEXT_PREFIX,
} from '@src/sidecar/adapters/chatProviderMessages.js';

function ndjsonDone(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`,
          ),
        );
        controller.close();
      },
    }),
    { status: 200 },
  );
}

describe('OllamaChatAdapter user prompts integration (CHAT-4)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Y8_forwards_assembled_messages_verbatim', async () => {
    const assembled: ChatMessage[] = [
      { role: 'system', content: GROUNDING_POLICY_V1 },
      { role: 'system', content: 'vault-org-line' },
      { role: 'system', content: 'persona-line' },
      { role: 'system', content: `${VAULT_CONTEXT_PREFIX}retrieval` },
      { role: 'user', content: 'Q' },
    ];
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { messages: ChatMessage[] };
      expect(body.messages).toEqual(assembled);
      return ndjsonDone();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaChatAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'm',
    });
    for await (const _ of adapter.complete(assembled, '', undefined)) {
      void _;
    }
    expect(fetchMock).toHaveBeenCalled();
  });
});
