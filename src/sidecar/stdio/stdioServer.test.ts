import { describe, expect, it, vi, afterEach } from 'vitest';
import pino from 'pino';
import { dispatchStdioLine } from './stdioServer.js';
import { SidecarRuntime } from '../runtime/SidecarRuntime.js';
import { ProgressAdapter } from '../adapters/ProgressAdapter.js';

describe('stdioServer', () => {
  const log = pino({ level: 'silent' });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OBSIDIAN_AI_DB_PATH;
  });

  it('A1_health_without_db', async () => {
    const progress = new ProgressAdapter({});
    const runtime = new SidecarRuntime({ log, progress });
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString());
      return true;
    });
    await dispatchStdioLine(runtime, log, JSON.stringify({ id: 'h1', type: 'health' }));
    const line = chunks.join('').trim();
    const msg = JSON.parse(line) as { body: { status: string; dbReady: boolean } };
    expect(msg.body.status).toBe('ok');
    expect(msg.body.dbReady).toBe(false);
  });

  it('A2_unknown_type_error', async () => {
    const progress = new ProgressAdapter({});
    const runtime = new SidecarRuntime({ log, progress });
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString());
      return true;
    });
    await dispatchStdioLine(
      runtime,
      log,
      JSON.stringify({ id: 'x1', type: 'not-a-real-op', payload: {} }),
    );
    const line = chunks.join('').trim();
    const msg = JSON.parse(line) as { error?: { message: string } };
    expect(msg.error?.message).toBeDefined();
  });
});
