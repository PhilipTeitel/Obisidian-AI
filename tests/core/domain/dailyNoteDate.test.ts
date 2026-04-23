import { describe, expect, it } from 'vitest';
import {
  formatNoteDateIso,
  parseDailyNoteDate,
  parseIsoNoteDate,
} from '@src/core/domain/dailyNoteDate.js';

describe('dailyNoteDate (RET-6)', () => {
  it('A2_parse_and_reject', () => {
    expect(parseDailyNoteDate('2026-04-16', 'YYYY-MM-DD')).toBe('2026-04-16');
    expect(parseDailyNoteDate('planning', 'YYYY-MM-DD')).toBeNull();
    expect(parseDailyNoteDate('2026-13-40', 'YYYY-MM-DD')).toBeNull();
  });

  it('formatNoteDateIso_and_parseIsoNoteDate_align_with_indexer', () => {
    expect(formatNoteDateIso(2026, 4, 9)).toBe('2026-04-09');
    expect(parseIsoNoteDate('2026-04-16')).toEqual({ y: 2026, m: 4, d: 16 });
    expect(parseIsoNoteDate('not-a-date')).toBeNull();
  });
});
