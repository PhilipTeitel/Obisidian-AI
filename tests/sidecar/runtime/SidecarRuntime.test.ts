import { describe, expect, it, vi, afterEach } from 'vitest';
import pino from 'pino';
import * as openMod from '@src/sidecar/db/open.js';
import { ProgressAdapter } from '@src/sidecar/adapters/ProgressAdapter.js';
import { SidecarRuntime } from '@src/sidecar/runtime/SidecarRuntime.js';

describe('SidecarRuntime', () => {
  const log = pino({ level: 'silent' });
  const progress = new ProgressAdapter({});

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OBSIDIAN_AI_DB_PATH;
  });

  it('B1_lazy_open_once', () => {
    const spy = vi.spyOn(openMod, 'openDatabase');
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const runtime = new SidecarRuntime({ log, progress });
    runtime.ensureDb();
    runtime.ensureDb();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('A1_db_not_ready_initially', () => {
    const runtime = new SidecarRuntime({ log, progress });
    expect(runtime.getHealth().dbReady).toBe(false);
    expect(runtime.getHealth().status).toBe('ok');
    expect(runtime.getHealth().uptime).toBeGreaterThanOrEqual(0);
  });

  it('A2_db_ready_after_open', () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const runtime = new SidecarRuntime({ log, progress });
    runtime.ensureDb();
    expect(runtime.getHealth().dbReady).toBe(true);
  });

  it('C1_index_full_ack', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const runtime = new SidecarRuntime({ log, progress });
    vi.spyOn(runtime, 'startIndexDrain').mockImplementation(() => {});
    const res = await runtime.handleSend({
      type: 'index/full',
      payload: {
        files: [{ path: 'a.md', content: '# Title\n\nHello.', hash: 'a'.repeat(64) }],
      },
    });
    expect(res.type).toBe('index/full');
    if (res.type !== 'index/full') throw new Error('expected index/full');
    expect(res.body.scannedCount).toBe(1);
    expect(res.body.noteCount).toBe(1);
    expect(res.body.enqueuedCount).toBe(1);
    expect(res.body.skippedCount).toBe(0);
    expect(res.body.deletedCount).toBe(0);
    expect(res.body.runId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
