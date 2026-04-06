import { describe, expect, it, vi } from 'vitest';
import type { IndexProgressEvent } from '../../core/domain/types.js';
import { ProgressAdapter } from './ProgressAdapter.js';

describe('ProgressAdapter', () => {
  const event: IndexProgressEvent = {
    jobId: 'j1',
    runId: 'r1',
    notePath: 'n.md',
    step: 'queued',
    status: 'started',
  };

  it('A1_stdout_sink', () => {
    const lines: string[] = [];
    const a = new ProgressAdapter({
      onStdioLine: (line) => lines.push(line),
    });
    a.emit(event);
    expect(lines).toHaveLength(1);
    const o = JSON.parse(lines[0]!) as { channel: string; type: string; event: IndexProgressEvent };
    expect(o.channel).toBe('push');
    expect(o.type).toBe('progress');
    expect(o.event.jobId).toBe('j1');
  });

  it('A2_dual_sink', () => {
    const lines: string[] = [];
    const ws: string[] = [];
    const a = new ProgressAdapter({
      onStdioLine: (line) => lines.push(line),
      onWsJson: (j) => ws.push(j),
    });
    a.emit(event);
    expect(ws).toHaveLength(1);
    const w = JSON.parse(ws[0]!) as { type: string; event: IndexProgressEvent };
    expect(w.type).toBe('progress');
    expect(w.event.runId).toBe('r1');
    expect(lines).toHaveLength(1);
  });

  it('sink_errors_swallowed', () => {
    const a = new ProgressAdapter({
      log: { warn: vi.fn() } as never,
      onStdioLine: () => {
        throw new Error('boom');
      },
    });
    expect(() => a.emit(event)).not.toThrow();
  });
});
