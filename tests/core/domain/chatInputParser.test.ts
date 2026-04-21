import { describe, expect, it } from 'vitest';
import { parseChatInput } from '@src/core/domain/chatInputParser.js';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('chatInputParser (RET-6)', () => {
  it('A3_extracts_path_and_last', () => {
    const r = parseChatInput('what did I do? path:Daily/**/*.md last:14d');
    expect(r.text).toBe('what did I do?');
    expect(r.pathGlobs).toEqual(['Daily/**/*.md']);
    expect(r.dateRange?.start).toBe(isoDaysAgo(14));
  });

  it('A4_since_before', () => {
    const r = parseChatInput('hello since:2026-04-01 before:2026-04-10');
    expect(r.text).toBe('hello');
    expect(r.dateRange).toEqual({ start: '2026-04-01', end: '2026-04-10' });
  });
});
