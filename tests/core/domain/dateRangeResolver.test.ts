import { describe, expect, it } from 'vitest';
import {
  anchorCalendarYmd,
  type ResolverClock,
  resolveDateRangeFromPrompt,
} from '@src/core/domain/dateRangeResolver.js';

function clockAt(isoUtc: string, ianaTimeZone: string | undefined): ResolverClock {
  return {
    now: () => new Date(isoUtc),
    timeZone: () => ianaTimeZone,
  };
}

describe('anchorCalendarYmd (ADR-016)', () => {
  it('uses_iana_when_offset_is_zero', () => {
    const clock: ResolverClock = {
      now: () => new Date('2026-04-21T12:00:00.000Z'),
      timeZone: () => 'UTC',
    };
    expect(anchorCalendarYmd(clock, 0)).toEqual({ y: 2026, m: 4, d: 21 });
  });

  it('nonzero_offset_wins_over_iana', () => {
    const clock: ResolverClock = {
      now: () => new Date('2026-04-21T02:00:00.000Z'),
      timeZone: () => 'UTC',
    };
    expect(anchorCalendarYmd(clock, -10)).toEqual({ y: 2026, m: 4, d: 20 });
  });
});

describe('dateRangeResolver (BUG-3)', () => {
  it('A1_last_2_weeks_rolling_14_days', () => {
    const clock = clockAt('2026-04-21T15:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt(
      'List out my job search activities over the last 2 weeks',
      clock,
      { utcOffsetHoursFallback: 0 },
    );
    expect(r?.matchRuleId).toBe('last_n_weeks');
    expect(r?.dateRange).toEqual({ start: '2026-04-08', end: '2026-04-21' });
  });

  it('A2_from_onwards_inclusive', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt('from March 16 onwards', clock, {
      utcOffsetHoursFallback: 0,
    });
    expect(r?.matchRuleId).toBe('from_onwards');
    expect(r?.dateRange).toEqual({ start: '2026-03-16', end: '2026-04-21' });
  });

  it('from_iso_onwards_in_sentence', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt(
      'What are the job search activities from 2026-04-15 onwards',
      clock,
      { utcOffsetHoursFallback: 0, dailyNotePathGlobs: ['daily/**/*.md'] },
    );
    expect(r?.matchRuleId).toBe('from_onwards');
    expect(r?.dateRange).toEqual({ start: '2026-04-15', end: '2026-04-21' });
    expect(r?.pathGlobs).toEqual(['daily/**/*.md']);
  });

  it('from_month_day_comma_year_in_sentence', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt(
      'What job search activities from April 20, 2026 occurred',
      clock,
      { utcOffsetHoursFallback: 0 },
    );
    expect(r?.matchRuleId).toBe('from_onwards');
    expect(r?.dateRange).toEqual({ start: '2026-04-20', end: '2026-04-21' });
  });

  it('explicit_year_not_misread_when_future_start_clamps_to_anchor', () => {
    const clock = clockAt('2026-04-15T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt('notes from April 20, 2026 please', clock, {
      utcOffsetHoursFallback: 0,
    });
    // ADR-016: resolved start after "today" clamps to anchor (single-day range).
    expect(r?.dateRange).toEqual({ start: '2026-04-15', end: '2026-04-15' });
  });

  it('A3_this_month', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt('summary this month', clock, { utcOffsetHoursFallback: 0 });
    expect(r?.matchRuleId).toBe('this_month');
    expect(r?.dateRange).toEqual({ start: '2026-04-01', end: '2026-04-21' });
  });

  it('A4_last_month', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt('tasks last month', clock, { utcOffsetHoursFallback: 0 });
    expect(r?.matchRuleId).toBe('last_month');
    expect(r?.dateRange).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('A5_today_and_yesterday', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    expect(resolveDateRangeFromPrompt('what I wrote today', clock, { utcOffsetHoursFallback: 0 })?.dateRange).toEqual({
      start: '2026-04-21',
      end: '2026-04-21',
    });
    expect(resolveDateRangeFromPrompt('yesterday notes', clock, { utcOffsetHoursFallback: 0 })?.dateRange).toEqual({
      start: '2026-04-20',
      end: '2026-04-20',
    });
  });

  it('A6_between_and_inclusive', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt('between March 1 and March 15', clock, {
      utcOffsetHoursFallback: 0,
    });
    expect(r?.matchRuleId).toBe('between_and');
    expect(r?.dateRange).toEqual({ start: '2026-03-01', end: '2026-03-15' });
  });

  it('Y5_pure_with_injected_clock', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const a = resolveDateRangeFromPrompt('last 2 weeks', clock, { utcOffsetHoursFallback: 0 });
    const b = resolveDateRangeFromPrompt('last 2 weeks', clock, { utcOffsetHoursFallback: 0 });
    expect(a).toEqual(b);
  });

  it('Y6_unrecognized_phrase_returns_null', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    expect(resolveDateRangeFromPrompt('hello world no dates here', clock, { utcOffsetHoursFallback: 0 })).toBeNull();
  });

  it('on_iso_date_in_sentence_scopes_daily_globs', () => {
    const clock = clockAt('2026-04-21T12:00:00.000Z', 'UTC');
    const r = resolveDateRangeFromPrompt(
      'what job search related activities were done on 2026-04-16',
      clock,
      { utcOffsetHoursFallback: 0, dailyNotePathGlobs: ['Daily/**'] },
    );
    expect(r?.matchRuleId).toBe('on_for_iso');
    expect(r?.dateRange).toEqual({ start: '2026-04-16', end: '2026-04-16' });
    expect(r?.pathGlobs).toEqual(['Daily/**']);
  });
});
