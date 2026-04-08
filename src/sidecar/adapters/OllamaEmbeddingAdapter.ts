import type { IEmbeddingPort } from '../../core/ports/IEmbeddingPort.js';

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
}

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Ollama's current embeddings API is `/api/embed`, which accepts either a single string
 * or an array in `input` and returns `embeddings`. Keep compatibility with older single-vector
 * response shapes in case the local server is behind the current docs.
 */
function ollamaEmbeddingsUrl(baseUrl: string): string {
  const base = trimBaseUrl(baseUrl);
  return `${base}/api/embed`;
}

export class OllamaEmbeddingAdapter implements IEmbeddingPort {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OllamaEmbeddingConfig) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.model = config.model.trim();
  }

  async embed(texts: string[], _apiKey?: string): Promise<Float32Array[]> {
    void _apiKey;
    if (texts.length === 0) return [];
    const url = ollamaEmbeddingsUrl(this.baseUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    const rawBody = await res.text();
    if (!res.ok) {
      console.warn('OllamaEmbeddingAdapter: embeddings request failed', {
        status: res.status,
        url,
      });
      throw new Error(`Ollama embeddings HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    }
    let json: { embeddings?: number[][]; embedding?: number[] };
    try {
      json = JSON.parse(rawBody) as { embeddings?: number[][]; embedding?: number[] };
    } catch {
      throw new Error(`Ollama embeddings: invalid JSON (HTTP ${res.status}): ${rawBody.slice(0, 200)}`);
    }
    if (Array.isArray(json.embeddings)) {
      return json.embeddings.map((embedding) => Float32Array.from(embedding));
    }
    if (Array.isArray(json.embedding)) {
      return [Float32Array.from(json.embedding)];
    }
    throw new Error('Ollama embeddings: response missing embeddings array');
  }
}
