/**
 * Deterministic English **time phrases** for chat retrieval (ADR-016, BUG-3).
 *
 * This is not a general natural-language understanding engine: it is a small, explicit vocabulary
 * (rolling windows, month names, ISO dates) mapped to calendar math. ADR-016 avoids new NLP deps.
 *
 * `dailyNoteDatePattern` applies only when the **indexer** parses basenames into `note_meta.note_date`.
 * Stored dates are always ISO `YYYY-MM-DD` ({@link parseDailyNoteDate}); bounds emitted here use the same
 * shape ({@link formatNoteDateIso}) so `dateRange` matches the DB.
 */
import { formatNoteDateIso, parseIsoNoteDate } from './dailyNoteDate.js';

export const UTC_OFFSET_HOURS_MIN = -12;
export const UTC_OFFSET_HOURS_MAX = 14;

export interface ResolverClock {
  now(): Date;
  timeZone(): string | undefined;
}

export interface ResolveOptions {
  utcOffsetHoursFallback: number;
  dailyNotePathGlobs?: string[];
}

export type DateRangeMatchRuleId =
  | 'last_n_weeks'
  | 'last_n_days'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'yesterday'
  | 'today'
  | 'from_onwards'
  | 'between_and'
  /** Single calendar day: "on 2026-04-16", "for 2026-04-16" (debug session 5899a7: unscoped retrieval otherwise). */
  | 'on_for_iso';

export interface ResolverMatch {
  dateRange: { start: string; end: string };
  pathGlobs?: string[];
  matchedPhrase: string;
  matchRuleId: DateRangeMatchRuleId;
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export function clampUtcOffsetHoursForResolver(raw: number | undefined): number {
  const n = raw === undefined ? 0 : Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.min(UTC_OFFSET_HOURS_MAX, Math.max(UTC_OFFSET_HOURS_MIN, n));
}

function ymdToNoteIso(ymd: Ymd): string {
  return formatNoteDateIso(ymd.y, ymd.m, ymd.d);
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

/**
 * Calendar "today" for the resolver anchor (ADR-016).
 * Non-zero `utcOffsetHoursFallback` wins over `clock.timeZone()` so the plugin setting applies when
 * the sidecar process timezone does not match the user's calendar (e.g. Node in UTC, vault in PST).
 * With offset `0`, IANA is used when present; otherwise UTC calendar from `now`.
 */
export function anchorCalendarYmd(clock: ResolverClock, utcOffsetHoursFallback: number): Ymd {
  const off = clampUtcOffsetHoursForResolver(utcOffsetHoursFallback);
  const inst = clock.now();
  if (off !== 0) {
    const shiftedMs = inst.getTime() + off * 3600 * 1000;
    const u = new Date(shiftedMs);
    return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
  }
  const tz = clock.timeZone();
  if (tz) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(inst);
    let y = 0;
    let mo = 0;
    let d = 0;
    for (const p of parts) {
      if (p.type === 'year') y = parseInt(p.value, 10);
      if (p.type === 'month') mo = parseInt(p.value, 10);
      if (p.type === 'day') d = parseInt(p.value, 10);
    }
    return { y, m: mo, d };
  }
  const u = new Date(inst.getTime());
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function ymdAddDays(ymd: Ymd, delta: number): Ymd {
  const dt = new Date(ymd.y, ymd.m - 1, ymd.d);
  dt.setDate(dt.getDate() + delta);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function normalizeMonthToken(tok: string): string {
  return tok.trim().toLowerCase().replace(/\.$/, '');
}

function parseMonthDayFragment(frag: string, anchor: Ymd): Ymd | null {
  const t = frag.trim();

  // Month D, YYYY — e.g. "April 20, 2026" (comma must not be stripped from capture).
  let m1 = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\s*$/i.exec(t);
  if (!m1) {
    m1 = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\s*$/i.exec(t);
  }
  if (m1) {
    const moName = normalizeMonthToken(m1[1]!);
    const day = parseInt(m1[2]!, 10);
    const y = parseInt(m1[3]!, 10);
    const mo = MONTHS[moName];
    if (
      mo &&
      Number.isFinite(day) &&
      Number.isFinite(y) &&
      y >= 1 &&
      y <= 9999 &&
      day >= 1 &&
      day <= daysInMonth(y, mo)
    ) {
      return { y, m: mo, d: day };
    }
    return null;
  }

  m1 = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(t);
  if (m1) {
    const moName = normalizeMonthToken(m1[1]!);
    const day = parseInt(m1[2]!, 10);
    const mo = MONTHS[moName];
    if (!mo || !Number.isFinite(day) || day < 1 || day > 31) return null;
    if (day > daysInMonth(anchor.y, mo)) return null;
    return resolveAmbiguousYearForMonthDay(mo, day, anchor);
  }
  m1 = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\b/i.exec(t);
  if (m1) {
    const day = parseInt(m1[1]!, 10);
    const moName = normalizeMonthToken(m1[2]!);
    const mo = MONTHS[moName];
    if (!mo || !Number.isFinite(day) || day < 1 || day > 31) return null;
    if (day > daysInMonth(anchor.y, mo)) return null;
    return resolveAmbiguousYearForMonthDay(mo, day, anchor);
  }
  const isoYmd = parseIsoNoteDate(t);
  if (isoYmd) return isoYmd;
  return null;
}

/** Most-recent past occurrence relative to anchor calendar date; future start clamps to anchor (ADR-016 D4). */
function resolveAmbiguousYearForMonthDay(month: number, day: number, anchor: Ymd): Ymd {
  let y = anchor.y;
  let cand: Ymd = { y, m: month, d: day };
  if (compareYmd(cand, anchor) > 0) {
    y -= 1;
    cand = { y, m: month, d: day };
  }
  if (compareYmd(cand, anchor) > 0) {
    return { ...anchor };
  }
  const dim = daysInMonth(cand.y, cand.m);
  if (cand.d > dim) {
    return { ...anchor };
  }
  return cand;
}

function pathGlobsFromOptions(options: ResolveOptions): string[] | undefined {
  const g = options.dailyNotePathGlobs?.map((x) => x.trim()).filter(Boolean) ?? [];
  return g.length > 0 ? [...g] : undefined;
}

export function resolveDateRangeFromPrompt(
  userText: string,
  clock: ResolverClock,
  options: ResolveOptions,
): ResolverMatch | null {
  const off = clampUtcOffsetHoursForResolver(options.utcOffsetHoursFallback);
  const anchor = anchorCalendarYmd(clock, off);
  const text = userText.trim();
  if (!text) return null;

  const attachGlobs = (): string[] | undefined => pathGlobsFromOptions(options);

  let m: RegExpExecArray | null;

  m = /\bbetween\s+(.+?)\s+and\s+(.+)$/i.exec(text.trimEnd());
  if (m) {
    const a = parseMonthDayFragment(m[1]!.trim(), anchor);
    const b = parseMonthDayFragment(m[2]!.trim(), anchor);
    if (a && b) {
      const [lo, hi] = compareYmd(a, b) <= 0 ? [a, b] : [b, a];
      return {
        dateRange: { start: ymdToNoteIso(lo), end: ymdToNoteIso(hi) },
        pathGlobs: attachGlobs(),
        matchedPhrase: m[0],
        matchRuleId: 'between_and',
      };
    }
  }

  m = /\bfrom\s+(.+?)\s+to\s+(.+)$/i.exec(text.trimEnd());
  if (m) {
    const a = parseMonthDayFragment(m[1]!.trim(), anchor);
    const b = parseMonthDayFragment(m[2]!.trim(), anchor);
    if (a && b) {
      const [lo, hi] = compareYmd(a, b) <= 0 ? [a, b] : [b, a];
      return {
        dateRange: { start: ymdToNoteIso(lo), end: ymdToNoteIso(hi) },
        pathGlobs: attachGlobs(),
        matchedPhrase: m[0],
        matchRuleId: 'between_and',
      };
    }
  }

  m = /\b(?:from|since)\s+(.+?)\s+onwards?\b/i.exec(text);
  if (!m) {
    // Longest-first alternation so "April 20, 2026" is one group (never "April 20" alone when a year follows).
    const fromSinceDate =
      /\b(?:from|since)\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{4}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?)\b/i;
    m = fromSinceDate.exec(text);
  }
  if (m && !/\bto\b/i.test(m[0])) {
    const inner = m[1]!.trim();
    if (!/^\d+\s*$/i.test(inner)) {
      const start = parseMonthDayFragment(inner, anchor);
      if (start) {
        const end = anchor;
        const lo = compareYmd(start, end) > 0 ? end : start;
        const hi = end;
        return {
          dateRange: { start: ymdToNoteIso(lo), end: ymdToNoteIso(hi) },
          pathGlobs: attachGlobs(),
          matchedPhrase: m[0].trim(),
          matchRuleId: 'from_onwards',
        };
      }
    }
  }

  m = /\b(?:last|past)\s+(\d+)\s+weeks?\b/i.exec(text);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) {
      const start = ymdAddDays(anchor, -(n * 7 - 1));
      return {
        dateRange: { start: ymdToNoteIso(start), end: ymdToNoteIso(anchor) },
        pathGlobs: attachGlobs(),
        matchedPhrase: m[0],
        matchRuleId: 'last_n_weeks',
      };
    }
  }

  m = /\b(?:last|past)\s+(\d+)\s+days?\b/i.exec(text);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) {
      const start = ymdAddDays(anchor, -(n - 1));
      return {
        dateRange: { start: ymdToNoteIso(start), end: ymdToNoteIso(anchor) },
        pathGlobs: attachGlobs(),
        matchedPhrase: m[0],
        matchRuleId: 'last_n_days',
      };
    }
  }

  if (/\bthis\s+week\b/i.test(text)) {
    const start = ymdAddDays(anchor, -6);
    return {
      dateRange: { start: ymdToNoteIso(start), end: ymdToNoteIso(anchor) },
      pathGlobs: attachGlobs(),
      matchedPhrase: 'this week',
      matchRuleId: 'this_week',
    };
  }

  if (/\bthis\s+month\b/i.test(text)) {
    const start: Ymd = { y: anchor.y, m: anchor.m, d: 1 };
    return {
      dateRange: { start: ymdToNoteIso(start), end: ymdToNoteIso(anchor) },
      pathGlobs: attachGlobs(),
      matchedPhrase: 'this month',
      matchRuleId: 'this_month',
    };
  }

  if (/\blast\s+month\b/i.test(text)) {
    const pm =
      anchor.m === 1
        ? { y: anchor.y - 1, m: 12 }
        : { y: anchor.y, m: anchor.m - 1 };
    const start: Ymd = { y: pm.y, m: pm.m, d: 1 };
    const end: Ymd = { y: pm.y, m: pm.m, d: daysInMonth(pm.y, pm.m) };
    return {
      dateRange: { start: ymdToNoteIso(start), end: ymdToNoteIso(end) },
      pathGlobs: attachGlobs(),
      matchedPhrase: 'last month',
      matchRuleId: 'last_month',
    };
  }

  if (/\byesterday\b/i.test(text)) {
    const y = ymdAddDays(anchor, -1);
    return {
      dateRange: { start: ymdToNoteIso(y), end: ymdToNoteIso(y) },
      pathGlobs: attachGlobs(),
      matchedPhrase: 'yesterday',
      matchRuleId: 'yesterday',
    };
  }

  if (/\btoday\b/i.test(text)) {
    return {
      dateRange: { start: ymdToNoteIso(anchor), end: ymdToNoteIso(anchor) },
      pathGlobs: attachGlobs(),
      matchedPhrase: 'today',
      matchRuleId: 'today',
    };
  }

  const onForIso = /\b(?:on|for)\s+(\d{4}-\d{2}-\d{2})\b/i.exec(text);
  if (onForIso) {
    const ymd = parseIsoNoteDate(onForIso[1]!);
    if (ymd) {
      return {
        dateRange: { start: ymdToNoteIso(ymd), end: ymdToNoteIso(ymd) },
        pathGlobs: attachGlobs(),
        matchedPhrase: onForIso[0],
        matchRuleId: 'on_for_iso',
      };
    }
  }

  return null;
}
