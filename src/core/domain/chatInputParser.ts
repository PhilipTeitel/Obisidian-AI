/**
 * Extract slash-style filter tokens from chat input (RET-6).
 */

export interface ParsedChatInput {
  text: string;
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysLocal(base: Date, deltaDays: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + deltaDays);
  return d;
}

/**
 * Parse `path:…`, `since:YYYY-MM-DD`, `before:YYYY-MM-DD`, `last:Nd`. Removes matched tokens from text.
 */
export function parseChatInput(raw: string): ParsedChatInput {
  let s = raw.trim();
  const pathGlobs: string[] = [];
  let start: string | undefined;
  let end: string | undefined;

  s = s.replace(/\bpath:([^\s]+)/g, (_, g: string) => {
    pathGlobs.push(g);
    return ' ';
  });

  s = s.replace(/\bsince:(\d{4}-\d{2}-\d{2})\b/g, (_, iso: string) => {
    start = iso;
    return ' ';
  });

  s = s.replace(/\bbefore:(\d{4}-\d{2}-\d{2})\b/g, (_, iso: string) => {
    end = iso;
    return ' ';
  });

  s = s.replace(/\blast:(\d+)d\b/gi, (_, n: string) => {
    const days = parseInt(n, 10);
    if (Number.isFinite(days) && days >= 0) {
      const today = new Date();
      const startD = addDaysLocal(today, -days);
      start = isoDateLocal(startD);
    }
    return ' ';
  });

  const text = collapseSpaces(s);
  const out: ParsedChatInput = { text };
  if (pathGlobs.length > 0) out.pathGlobs = pathGlobs;
  if (start !== undefined || end !== undefined) {
    out.dateRange = {};
    if (start !== undefined) out.dateRange.start = start;
    if (end !== undefined) out.dateRange.end = end;
  }
  return out;
}
