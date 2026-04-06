import type { IEmbeddingPort } from '../../core/ports/IEmbeddingPort.js';

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
}

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Ollama `/api/embeddings` accepts a single string `input` in common deployments.
 * We call once per text to preserve order (batching would require server-specific support).
 */
function ollamaEmbeddingsUrl(baseUrl: string): string {
  const base = trimBaseUrl(baseUrl);
  return `${base}/api/embeddings`;
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
    const url = ollamaEmbeddingsUrl(this.baseUrl);
    const results: Float32Array[] = [];
    for (const text of texts) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });
      const rawBody = await res.text();
      if (!res.ok) {
        console.warn('OllamaEmbeddingAdapter: embeddings request failed', {
          status: res.status,
          url,
        });
        throw new Error(`Ollama embeddings HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
      }
      let json: { embedding?: number[] };
      try {
        json = JSON.parse(rawBody) as { embedding?: number[] };
      } catch {
        throw new Error(`Ollama embeddings: invalid JSON (HTTP ${res.status}): ${rawBody.slice(0, 200)}`);
      }
      if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error('Ollama embeddings: response missing embedding array');
      }
      results.push(Float32Array.from(json.embedding));
    }
    return results;
  }
}
