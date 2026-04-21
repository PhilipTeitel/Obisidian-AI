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
      throw new Error(
        `Ollama embeddings: invalid JSON (HTTP ${res.status}): ${rawBody.slice(0, 200)}`,
      );
    }
    if (Array.isArray(json.embeddings)) {
      const out = json.embeddings.map((embedding) => Float32Array.from(embedding));
      // #region agent log
      fetch('http://127.0.0.1:7279/ingest/93aba0d1-d956-4d96-a52b-680185909f20',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14212f'},body:JSON.stringify({sessionId:'14212f',hypothesisId:'H1,H5',location:'OllamaEmbeddingAdapter.ts:embed',message:'ollama embed response',data:{url,model:this.model,inputCount:texts.length,returnedCount:out.length,firstLen:out[0]?.length,lastLen:out[out.length-1]?.length,shape:'embeddings'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return out;
    }
    if (Array.isArray(json.embedding)) {
      const out = [Float32Array.from(json.embedding)];
      // #region agent log
      fetch('http://127.0.0.1:7279/ingest/93aba0d1-d956-4d96-a52b-680185909f20',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14212f'},body:JSON.stringify({sessionId:'14212f',hypothesisId:'H1,H5',location:'OllamaEmbeddingAdapter.ts:embed',message:'ollama embed response (legacy)',data:{url,model:this.model,inputCount:texts.length,returnedCount:out.length,firstLen:out[0]?.length,shape:'embedding'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return out;
    }
    throw new Error('Ollama embeddings: response missing embeddings array');
  }
}
