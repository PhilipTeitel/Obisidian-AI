import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import * as readline from 'node:readline';
import type {
  ChatStreamChunk,
  GroundingOutcome,
  SidecarRequest,
  SidecarResponse,
} from '../../core/domain/types.js';
import type { ISidecarTransport } from '../../core/ports/ISidecarTransport.js';

type Pending = {
  resolve: (v: SidecarResponse) => void;
  reject: (e: Error) => void;
};

/**
 * PLG-2: NDJSON over child stdin/stdout (SRV-1).
 */
export class StdioTransportAdapter implements ISidecarTransport {
  private readonly pending = new Map<string, Pending>();
  private readonly lineWaiters: Array<(line: string) => void> = [];
  private lineBuffer: string[] = [];
  private rl: readline.Interface;
  private closed = false;

  constructor(stdin: Writable, stdout: NodeJS.ReadableStream) {
    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.onLine(line));
    this.stdin = stdin;
  }

  private readonly stdin: Writable;

  private pushLine(line: string): void {
    const w = this.lineWaiters.shift();
    if (w) w(line);
    else this.lineBuffer.push(line);
  }

  private nextLine(): Promise<string> {
    if (this.lineBuffer.length > 0) return Promise.resolve(this.lineBuffer.shift()!);
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('StdioTransportAdapter closed'));
        return;
      }
      this.lineWaiters.push(resolve);
    });
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.channel === 'push') {
      this.pushLine(line);
      return;
    }
    if (typeof msg.id === 'string' && msg.requestId === undefined) {
      const id = msg.id;
      const p = this.pending.get(id);
      if (!p) {
        this.pushLine(line);
        return;
      }
      if (msg.error && typeof (msg.error as { message?: string }).message === 'string') {
        this.pending.delete(id);
        p.reject(new Error((msg.error as { message: string }).message));
        return;
      }
      if (msg.body !== undefined && typeof msg.type === 'string') {
        this.pending.delete(id);
        p.resolve({ type: msg.type, body: msg.body } as SidecarResponse);
        return;
      }
    }
    this.pushLine(line);
  }

  async send(request: Exclude<SidecarRequest, { type: 'chat' }>): Promise<SidecarResponse> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload: Record<string, unknown> = { id, type: request.type };
      if ('payload' in request && request.payload !== undefined) {
        payload.payload = request.payload;
      }
      const ok = this.stdin.write(`${JSON.stringify(payload)}\n`);
      if (!ok) {
        this.stdin.once('drain', () => undefined);
      }
    });
  }

  async *streamChat(
    request: Extract<SidecarRequest, { type: 'chat' }>['payload'],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<ChatStreamChunk> {
    const id = randomUUID();
    const payload = { id, type: 'chat', payload: request };
    this.stdin.write(`${JSON.stringify(payload)}\n`);

    const abortError = () => new Error('chat aborted');
    const onAbort = () => {
      /* reader may throw on next line */
    };
    options?.signal?.addEventListener('abort', onAbort);

    try {
      while (true) {
        if (options?.signal?.aborted) throw abortError();
        const line = await this.nextLine();
        if (options?.signal?.aborted) throw abortError();
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg.channel === 'push' && msg.requestId === id && msg.type === 'chat') {
          const chunk = msg.chunk as { type: string; delta?: string };
          if (chunk.type === 'delta') {
            yield { type: 'delta', delta: chunk.delta ?? '' };
          }
          continue;
        }
        if (msg.id === id && msg.error) {
          throw new Error(String((msg.error as { message?: string }).message ?? 'chat error'));
        }
        if (msg.id === id && msg.type === 'chat' && msg.done === true) {
          type Source = import('../../core/domain/types.js').Source;
          yield {
            type: 'done',
            sources: (msg.sources as Source[]) ?? [],
            groundingOutcome: (msg.groundingOutcome as GroundingOutcome) ?? 'answered',
            groundingPolicyVersion:
              typeof msg.groundingPolicyVersion === 'string' ? msg.groundingPolicyVersion : 'v1',
          };
          return;
        }
      }
    } finally {
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  close(): void {
    this.closed = true;
    this.rl.close();
    for (const w of this.lineWaiters) {
      w('');
    }
    this.lineWaiters.length = 0;
  }
}
