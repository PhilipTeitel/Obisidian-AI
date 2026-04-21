import { describe, expect, it } from 'vitest';
import { parseDailyNoteDate } from '@src/core/domain/dailyNoteDate.js';

describe('dailyNoteDate (RET-6)', () => {
  it('A2_parse_and_reject', () => {
    expect(parseDailyNoteDate('2026-04-16', 'YYYY-MM-DD')).toBe('2026-04-16');
    expect(parseDailyNoteDate('planning', 'YYYY-MM-DD')).toBeNull();
    expect(parseDailyNoteDate('2026-13-40', 'YYYY-MM-DD')).toBeNull();
  });
});
