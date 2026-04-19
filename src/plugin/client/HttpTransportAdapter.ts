import type {
  ChatStreamChunk,
  HealthResponse,
  SidecarRequest,
  SidecarResponse,
  Source,
} from '../../core/domain/types.js';
import type { ISidecarTransport } from '../../core/ports/ISidecarTransport.js';

function assertLocalhost(baseUrl: string): void {
  if (!baseUrl.startsWith('http://127.0.0.1')) {
    throw new Error('HttpTransportAdapter: only http://127.0.0.1 is allowed');
  }
}

/**
 * PLG-3: REST + NDJSON chat stream (SRV-2). WebSocket progress is optional for a later UI story.
 */
export class HttpTransportAdapter implements ISidecarTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    assertLocalhost(baseUrl.replace(/\/$/, ''));
  }

  private base(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  private headersJson(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async send(request: Exclude<SidecarRequest, { type: 'chat' }>): Promise<SidecarResponse> {
    const b = this.base();
    switch (request.type) {
      case 'health': {
        const r = await fetch(`${b}/health`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        const body = (await r.json()) as HealthResponse;
        if (!r.ok) throw new Error(`health failed: ${r.status}`);
        return { type: 'health', body };
      }
      case 'index/full': {
        const r = await fetch(`${b}/index/full`, {
          method: 'POST',
          headers: this.headersJson(),
          body: JSON.stringify(request.payload),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(`index/full failed: ${r.status}`);
        return { type: 'index/full', body };
      }
      case 'index/incremental': {
        const r = await fetch(`${b}/index/incremental`, {
          method: 'POST',
          headers: this.headersJson(),
          body: JSON.stringify(request.payload),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(`index/incremental failed: ${r.status}`);
        return { type: 'index/incremental', body };
      }
      case 'index/status': {
        const r = await fetch(`${b}/index/status`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        const body = await r.json();
        if (!r.ok) throw new Error(`index/status failed: ${r.status}`);
        return { type: 'index/status', body };
      }
      case 'search': {
        const r = await fetch(`${b}/search`, {
          method: 'POST',
          headers: this.headersJson(),
          body: JSON.stringify(request.payload),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(`search failed: ${r.status}`);
        return { type: 'search', body };
      }
      case 'chat/clear': {
        const r = await fetch(`${b}/chat/clear`, { method: 'POST', headers: this.headersJson() });
        const body = await r.json();
        if (!r.ok) throw new Error(`chat/clear failed: ${r.status}`);
        return { type: 'chat/clear', body };
      }
      default: {
        const _x: never = request;
        throw new Error(`unsupported ${JSON.stringify(_x)}`);
      }
    }
  }

  async *streamChat(
    request: Extract<SidecarRequest, { type: 'chat' }>['payload'],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<ChatStreamChunk> {
    const r = await fetch(`${this.base()}/chat`, {
      method: 'POST',
      headers: this.headersJson(),
      body: JSON.stringify(request),
      signal: options?.signal,
    });
    if (!r.ok) throw new Error(`chat failed: ${r.status}`);
    const text = await r.text();
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const msg = JSON.parse(t) as {
        type?: string;
        chunk?: ChatStreamChunk;
        done?: boolean;
        sources?: Source[];
      };
      if (msg.type === 'chat' && msg.chunk) {
        yield msg.chunk;
      }
      if (msg.type === 'chat' && msg.done && msg.sources) {
        yield { type: 'done', sources: msg.sources };
        return;
      }
    }
  }
}
