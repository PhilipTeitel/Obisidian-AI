import type { IEmbeddingPort } from '../../core/ports/IEmbeddingPort.js';

export interface OpenAIEmbeddingConfig {
  baseUrl: string;
  model: string;
}

/**
 * OpenAI embeddings API allows large batches; cap per request to stay within documented limits.
 * @see https://platform.openai.com/docs/api-reference/embeddings
 */
const OPENAI_EMBEDDING_MAX_INPUTS_PER_REQUEST = 2048;

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Join OpenAI-style base (`…/v1`) with path (`/embeddings` → `…/v1/embeddings`). */
function openAiUrl(baseUrl: string, path: string): string {
  const base = trimBaseUrl(baseUrl);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export class OpenAIEmbeddingAdapter implements IEmbeddingPort {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OpenAIEmbeddingConfig) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.model = config.model.trim();
  }

  async embed(texts: string[], apiKey?: string): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += OPENAI_EMBEDDING_MAX_INPUTS_PER_REQUEST) {
      const batch = texts.slice(i, i + OPENAI_EMBEDDING_MAX_INPUTS_PER_REQUEST);
      const part = await this.embedOneBatch(batch, apiKey);
      out.push(...part);
    }
    return out;
  }

  private async embedOneBatch(texts: string[], apiKey?: string): Promise<Float32Array[]> {
    const url = openAiUrl(this.baseUrl, '/embeddings');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey !== undefined && apiKey !== '') {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    const rawBody = await res.text();
    if (!res.ok) {
      console.warn('OpenAIEmbeddingAdapter: embeddings request failed', {
        status: res.status,
        url,
      });
      let msg = `OpenAI embeddings HTTP ${res.status}`;
      try {
        const j = JSON.parse(rawBody) as { error?: { message?: string } };
        if (j.error?.message) msg += `: ${j.error.message}`;
        else msg += `: ${rawBody.slice(0, 200)}`;
      } catch {
        msg += `: ${rawBody.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    let json: { data: Array<{ embedding: number[]; index: number }> };
    try {
      json = JSON.parse(rawBody) as { data: Array<{ embedding: number[]; index: number }> };
    } catch {
      throw new Error(
        `OpenAI embeddings: invalid JSON (HTTP ${res.status}): ${rawBody.slice(0, 200)}`,
      );
    }
    if (!Array.isArray(json.data)) {
      throw new Error('OpenAI embeddings: response missing data array');
    }
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    const out = sorted.map((d) => Float32Array.from(d.embedding));
    // #region agent log
    fetch('http://127.0.0.1:7279/ingest/93aba0d1-d956-4d96-a52b-680185909f20',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14212f'},body:JSON.stringify({sessionId:'14212f',hypothesisId:'H2,H5',location:'OpenAIEmbeddingAdapter.ts:embedOneBatch',message:'openai embed response',data:{url,model:this.model,inputCount:texts.length,returnedCount:out.length,firstLen:out[0]?.length,lastLen:out[out.length-1]?.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return out;
  }
}
