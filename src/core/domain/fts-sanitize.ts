/**
 * Neutralize FTS5 operator characters so user text is interpreted as literal tokens (RET-5 Y6).
 * Replaces: `" * ( ) : - ^` with spaces, then collapses whitespace.
 */
const FTS_SPECIAL = /["*():\-^]/g;

export function sanitizeFtsQuery(raw: string): string {
  return raw.replace(FTS_SPECIAL, ' ').replace(/\s+/g, ' ').trim();
}
