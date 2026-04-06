import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { StdioTransportAdapter } from '@src/plugin/client/StdioTransportAdapter.js';

describe('StdioTransportAdapter', () => {
  it('A1_health_roundtrip', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const adapter = new StdioTransportAdapter(stdin, stdout);

    stdin.on('data', (buf: Buffer) => {
      const line = buf.toString().trim();
      const req = JSON.parse(line) as { id: string };
      setImmediate(() => {
        stdout.write(
          `${JSON.stringify({
            id: req.id,
            type: 'health',
            body: { status: 'ok', uptime: 0, dbReady: false },
          })}\n`,
        );
      });
    });

    const res = await adapter.send({ type: 'health' });
    expect(res.type).toBe('health');
    if (res.type === 'health') {
      expect(res.body.status).toBe('ok');
      expect(res.body.dbReady).toBe(false);
    }
    adapter.close();
  });
});
