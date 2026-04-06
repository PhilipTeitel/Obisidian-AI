import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpTransportAdapter } from './HttpTransportAdapter.js';

describe('HttpTransportAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Y1_localhost_only', () => {
    expect(() => new HttpTransportAdapter('http://example.com/', 't')).toThrow(/127\.0\.0\.1/);
  });

  it('A1_health_fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok', uptime: 0, dbReady: false }),
      }),
    );
    const h = new HttpTransportAdapter('http://127.0.0.1:9', 'tok');
    const res = await h.send({ type: 'health' });
    expect(res.type).toBe('health');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9/health',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok' },
      }),
    );
  });
});
