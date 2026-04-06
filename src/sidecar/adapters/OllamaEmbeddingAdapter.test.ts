import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaEmbeddingAdapter } from './OllamaEmbeddingAdapter.js';

describe('OllamaEmbeddingAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('B1_ollama_url_and_body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.5, -0.5] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaEmbeddingAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'nomic-embed-text',
    });
    await adapter.embed(['hello']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/embeddings');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { model: string; input: string };
    expect(body.model).toBe('nomic-embed-text');
    expect(body.input).toBe('hello');
  });

  it('B1_normalizes_trailing_slash_on_base', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embedding: [1] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaEmbeddingAdapter({
      baseUrl: 'http://127.0.0.1:11434///',
      model: 'm',
    });
    await adapter.embed(['a']);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/embeddings');
  });

  it('B2_ollama_order', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: [0, 2] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaEmbeddingAdapter({
      baseUrl: 'http://localhost:11434',
      model: 'm',
    });
    const vecs = await adapter.embed(['first', 'second']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vecs[0]).toEqual(new Float32Array([1, 0]));
    expect(vecs[1]).toEqual(new Float32Array([0, 2]));
  });
});
