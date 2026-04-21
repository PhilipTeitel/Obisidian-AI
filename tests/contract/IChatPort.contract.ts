import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@src/core/domain/types.js';
import { OllamaChatAdapter } from '@src/sidecar/adapters/OllamaChatAdapter.js';
import { OpenAIChatAdapter } from '@src/sidecar/adapters/OpenAIChatAdapter.js';

function sseDone(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

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

describe('IChatPort contract (CHAT-3)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('IChatPort_preserves_assembled_messages_unchanged', async () => {
    const assembledOpenAI: ChatMessage[] = [
      { role: 'system', content: 'built-in-policy' },
      { role: 'system', content: 'vault-ctx' },
      { role: 'user', content: 'hi' },
    ];
    const fetchOpenAI = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { messages: ChatMessage[] };
      expect(body.messages).toEqual(assembledOpenAI);
      return sseDone();
    });
    globalThis.fetch = fetchOpenAI as unknown as typeof fetch;
    const openai = new OpenAIChatAdapter({ baseUrl: 'https://api.openai.com/v1', model: 'm' });
    for await (const _ of openai.complete(assembledOpenAI, '', undefined)) {
      void _;
    }

    const assembledOllama: ChatMessage[] = [
      { role: 'system', content: 'built-in-policy' },
      { role: 'assistant', content: 'prior' },
      { role: 'user', content: 'next' },
    ];
    const fetchOllama = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { messages: ChatMessage[] };
      expect(body.messages).toEqual(assembledOllama);
      return ndjsonDone();
    });
    globalThis.fetch = fetchOllama as unknown as typeof fetch;
    const ollama = new OllamaChatAdapter({ baseUrl: 'http://127.0.0.1:11434', model: 'm' });
    for await (const _ of ollama.complete(assembledOllama, '', undefined)) {
      void _;
    }
  });
});
