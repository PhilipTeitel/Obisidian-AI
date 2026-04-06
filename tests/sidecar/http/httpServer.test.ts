import { describe, expect, it, afterEach } from 'vitest';
import { once } from 'node:events';
import pino from 'pino';
import { ProgressAdapter } from '@src/sidecar/adapters/ProgressAdapter.js';
import { SidecarRuntime } from '@src/sidecar/runtime/SidecarRuntime.js';
import { startHttpServer } from '@src/sidecar/http/httpServer.js';

describe('httpServer', () => {
  const log = pino({ level: 'silent' });

  afterEach(() => {
    delete process.env.OBSIDIAN_AI_DB_PATH;
  });

  it('A1_localhost_only', async () => {
    const progress = new ProgressAdapter({});
    const runtime = new SidecarRuntime({ log, progress });
    const server = startHttpServer(runtime, log, {
      port: 0,
      token: 'test-secret',
      onWsClient: () => () => {},
    });
    await once(server, 'listening');
    const addr = server.address();
    expect(addr).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('A2_bearer_required', async () => {
    const progress = new ProgressAdapter({});
    const runtime = new SidecarRuntime({ log, progress });
    const server = startHttpServer(runtime, log, {
      port: 0,
      token: 'tok',
      onWsClient: () => () => {},
    });
    await once(server, 'listening');
    const { port } = server.address() as import('node:net').AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(401);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('B1_health_json', async () => {
    const progress = new ProgressAdapter({});
    const runtime = new SidecarRuntime({ log, progress });
    const server = startHttpServer(runtime, log, {
      port: 0,
      token: 'tok2',
      onWsClient: () => () => {},
    });
    await once(server, 'listening');
    const { port } = server.address() as import('node:net').AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: 'Bearer tok2' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; dbReady: boolean; uptime: number };
    expect(body.status).toBe('ok');
    expect(body.dbReady).toBe(false);
    expect(typeof body.uptime).toBe('number');
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
