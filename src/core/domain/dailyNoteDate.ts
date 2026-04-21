/**
 * Parse daily-note filename stems using configurable YYYY / MM / DD patterns (ADR-014).
 */

function escapeRegexLiteral(s: string): string {
  return s.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
}

function isValidYmd(y: string, m: string, d: string): boolean {
  const yi = parseInt(y, 10);
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  if (!Number.isFinite(yi) || !Number.isFinite(mi) || !Number.isFinite(di)) return false;
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return false;
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  return (
    dt.getUTCFullYear() === yi && dt.getUTCMonth() === mi - 1 && dt.getUTCDate() === di
  );
}

/**
 * Parse `basename` (no directory, typically without extension) using `pattern`
 * with tokens `YYYY`, `MM`, `DD`. Returns ISO `YYYY-MM-DD` or `null`.
 */
export function parseDailyNoteDate(basename: string, pattern: string): string | null {
  const base = basename.trim();
  if (!base || !pattern.trim()) return null;

  const parts = pattern.split(/(YYYY|MM|DD)/);
  let regex = '^';
  const order: Array<'y' | 'm' | 'd'> = [];
  for (const p of parts) {
    if (p === 'YYYY') {
      regex += '(\\d{4})';
      order.push('y');
    } else if (p === 'MM') {
      regex += '(\\d{2})';
      order.push('m');
    } else if (p === 'DD') {
      regex += '(\\d{2})';
      order.push('d');
    } else if (p) {
      regex += escapeRegexLiteral(p);
    }
  }
  regex += '$';

  let m: RegExpExecArray | null;
  try {
    m = new RegExp(regex).exec(base);
  } catch {
    return null;
  }
  if (!m) return null;

  let y = '';
  let mo = '';
  let d = '';
  let gi = 1;
  for (const o of order) {
    const v = m[gi++];
    if (!v) return null;
    if (o === 'y') y = v;
    else if (o === 'm') mo = v;
    else d = v;
  }
  if (!y || !mo || !d) return null;
  if (!isValidYmd(y, mo, d)) return null;
  return `${y}-${mo}-${d}`;
}
