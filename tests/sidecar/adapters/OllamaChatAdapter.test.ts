import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaChatAdapter } from '@src/sidecar/adapters/OllamaChatAdapter.js';
import { VAULT_CONTEXT_PREFIX } from '@src/sidecar/adapters/chatProviderMessages.js';

function ndjsonResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(enc.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('OllamaChatAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('C1_ollama_stream_deltas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({
          message: { role: 'assistant', content: 'a' },
          done: false,
        }),
        JSON.stringify({
          message: { role: 'assistant', content: 'ab' },
          done: false,
        }),
        JSON.stringify({ message: { role: 'assistant', content: 'ab' }, done: true }),
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaChatAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3',
    });
    let out = '';
    for await (const d of adapter.complete([{ role: 'user', content: 'hi' }], '', undefined)) {
      out += d;
    }
    expect(out).toBe('ab');
  });

  it('C2_ollama_context_rules', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      expect(_url).toBe('http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(init!.body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      // B2-style
      const msgs1 = body.messages;
      expect(msgs1[0].role).toBe('system');
      expect(msgs1[0].content).toBe(`${VAULT_CONTEXT_PREFIX}V`);
      expect(msgs1[1]).toEqual({ role: 'user', content: 'Q' });

      return ndjsonResponse([
        JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }),
      ]);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaChatAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'm',
    });
    for await (const _ of adapter.complete([{ role: 'user', content: 'Q' }], 'V', undefined)) {
      void _;
    }

    const fetchMock2 = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages).toEqual([
        { role: 'system', content: 'S' },
        { role: 'user', content: 'body' },
      ]);
      return ndjsonResponse([
        JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }),
      ]);
    });
    globalThis.fetch = fetchMock2 as unknown as typeof fetch;

    for await (const _ of adapter.complete([{ role: 'system', content: 'S' }], 'body', undefined)) {
      void _;
    }
  });
});
