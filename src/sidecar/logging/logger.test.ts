import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DestinationStream } from 'pino';
import { createSidecarLogger } from './logger.js';

describe('createSidecarLogger', () => {
  it('A1_log_level_env', () => {
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const log = createSidecarLogger({ level: 'error', destination: sink as DestinationStream });
    log.info('hidden');
    log.error('shown');
    expect(chunks.some((c) => c.includes('hidden'))).toBe(false);
    expect(chunks.some((c) => c.includes('shown'))).toBe(true);
  });
});
