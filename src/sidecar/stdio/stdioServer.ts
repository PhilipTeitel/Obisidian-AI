import * as readline from 'node:readline';
import type { SidecarRequest } from '../../core/domain/types.js';
import type { SidecarRuntime } from '../runtime/SidecarRuntime.js';
import type { Logger } from 'pino';

function writeLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * SRV-1: NDJSON request/response on stdin/stdout; progress pushes via {@link ProgressAdapter}.
 */
export function startStdioServer(runtime: SidecarRuntime, log: Logger): void {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void dispatchStdioLine(runtime, log, trimmed).catch((e) => {
      log.error({ err: e }, 'stdio.line_failed');
    });
  });
}

/** Exported for tests (A1/A2). */
export async function dispatchStdioLine(
  runtime: SidecarRuntime,
  log: Logger,
  line: string,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    writeLine({ id: 'unknown', error: { message: 'invalid JSON' } });
    return;
  }
  if (!isRecord(parsed) || typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
    writeLine({
      id: isRecord(parsed) && typeof parsed.id === 'string' ? parsed.id : 'unknown',
      error: { message: 'missing id or type' },
    });
    return;
  }
  const id = parsed.id;
  const type = parsed.type;
  const payload = parsed.payload;

  if (type === 'chat') {
    if (!isRecord(payload) || !Array.isArray(payload.messages)) {
      writeLine({ id, error: { message: 'chat requires payload.messages' } });
      return;
    }
    try {
      const gen = runtime.handleChatStream(
        payload as Extract<SidecarRequest, { type: 'chat' }>['payload'],
        {},
      );
      let step = await gen.next();
      while (!step.done) {
        writeLine({
          channel: 'push',
          requestId: id,
          type: 'chat',
          chunk: step.value,
        });
        step = await gen.next();
      }
      writeLine({
        id,
        type: 'chat',
        done: true,
        sources: step.value.sources,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, id }, 'stdio.chat_failed');
      writeLine({ id, error: { message } });
    }
    return;
  }

  try {
    const req = { type, payload } as Exclude<SidecarRequest, { type: 'chat' }>;
    const res = await runtime.handleSend(req);
    writeLine({ id, type: res.type, body: res.body });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn({ err: e, id, type }, 'stdio.rpc_failed');
    writeLine({ id, error: { message } });
  }
}
