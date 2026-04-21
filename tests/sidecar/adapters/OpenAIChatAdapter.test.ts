import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatAdapter } from '@src/sidecar/adapters/OpenAIChatAdapter.js';
import {
  GROUNDING_POLICY_V1,
  VAULT_CONTEXT_PREFIX,
} from '@src/sidecar/adapters/chatProviderMessages.js';

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(enc.encode(line));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenAIChatAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('B1_openai_sse_deltas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIChatAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
    let out = '';
    for await (const d of adapter.complete([{ role: 'user', content: 'hi' }], '', undefined)) {
      out += d;
    }
    expect(out).toBe('Hello');
  });

  it('B2_context_before_last_user', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe(GROUNDING_POLICY_V1);
      expect(body.messages[1].content).toBe(`${VAULT_CONTEXT_PREFIX}V`);
      expect(body.messages[2]).toEqual({ role: 'user', content: 'Q' });
      return sseResponse(['data: [DONE]\n\n']);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIChatAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    for await (const _ of adapter.complete([{ role: 'user', content: 'Q' }], 'V', undefined)) {
      void _;
    }
  });

  it('B3_summary_shape', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages).toEqual([
        { role: 'system', content: GROUNDING_POLICY_V1 },
        { role: 'system', content: 'S' },
        { role: 'user', content: 'body' },
      ]);
      return sseResponse(['data: [DONE]\n\n']);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIChatAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    for await (const _ of adapter.complete([{ role: 'system', content: 'S' }], 'body', undefined)) {
      void _;
    }
  });

  it('D1_abort_stops_stream', async () => {
    const enc = new TextEncoder();
    const ac = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
      },
      pull() {
        return new Promise(() => {});
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIChatAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    const gen = adapter.complete([{ role: 'user', content: 'x' }], '', undefined, {
      signal: ac.signal,
    });
    const it = gen[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe('a');
    ac.abort();
    const second = await it.next();
    expect(second.done).toBe(true);
  });

  it('D2_timeout_aborts_fetch', async () => {
    /** Real timers: `fetch` + stream abort integrates with `AbortSignal` from `setTimeout` (Node undici). */
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"."}}]}\n\n'));
      },
      pull() {
        return new Promise(() => {});
      },
    });
    let captured: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      captured = init?.signal;
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIChatAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    const parts: string[] = [];
    for await (const d of adapter.complete([{ role: 'user', content: 'x' }], '', undefined, {
      timeoutMs: 80,
    })) {
      parts.push(d);
    }
    expect(parts).toEqual(['.']);
    expect(captured?.aborted).toBe(true);
  }, 10_000);
});
