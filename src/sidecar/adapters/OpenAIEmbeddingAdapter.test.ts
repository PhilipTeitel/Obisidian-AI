import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIEmbeddingAdapter } from './OpenAIEmbeddingAdapter.js';

describe('OpenAIEmbeddingAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('A1_openai_batch_payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { embedding: [0, 0, 1], index: 0 },
            { embedding: [0, 1, 0], index: 1 },
            { embedding: [1, 0, 0], index: 2 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIEmbeddingAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
    });
    const texts = ['a', 'b', 'c'];
    await adapter.embed(texts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { input: string[]; model: string };
    expect(body.model).toBe('text-embedding-3-small');
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input).toHaveLength(3);
    expect(body.input).toEqual(texts);
  });

  it('A2_openai_bearer_header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [1], index: 0 }] }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAIEmbeddingAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    await adapter.embed(['x'], 'sk-test');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer sk-test');
  });

  it('A3_openai_order_and_errors', async () => {
    const fetchOk = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { embedding: [3], index: 2 },
            { embedding: [1], index: 0 },
            { embedding: [2], index: 1 },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchOk as unknown as typeof fetch;

    const adapter = new OpenAIEmbeddingAdapter({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    const vecs = await adapter.embed(['a', 'b', 'c']);
    expect(vecs.map((v) => v[0])).toEqual([1, 2, 3]);

    const fetchErr = vi.fn().mockResolvedValue(new Response('not json', { status: 502 }));
    globalThis.fetch = fetchErr as unknown as typeof fetch;
    await expect(adapter.embed(['a'])).rejects.toThrow(/502/);
  });
});
