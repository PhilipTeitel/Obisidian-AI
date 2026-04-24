/**
 * Build an FTS5 MATCH expression from free-form user text (ADR-017, BUG-4).
 * Tokenizes on non-alphanumeric (plus Unicode letters ≥ U+0080 per binding spec), drops FTS5
 * reserved words, quotes each token as a phrase, OR-joins up to `maxTerms`.
 */

const TOKEN_SPLIT = /[^0-9A-Za-z\u0080-\uFFFF]+/u;
const FTS_RESERVED = new Set(['and', 'or', 'not', 'near']);
export const DEFAULT_FTS_MATCH_MAX_TERMS = 64;

export interface BuildFtsMatchQueryOptions {
  /** Defaults to {@link DEFAULT_FTS_MATCH_MAX_TERMS}. */
  maxTerms?: number;
}

function escapePhraseToken(token: string): string {
  return token.replace(/"/g, '""');
}

/**
 * Produce an FTS5 MATCH expression safe for `nodes_fts MATCH ?`, given free-form user text.
 * Returns `null` when the input yields zero usable tokens — callers must skip the BM25 leg.
 */
export function buildFtsMatchQuery(
  raw: string,
  options?: BuildFtsMatchQueryOptions,
): string | null {
  const maxTerms = options?.maxTerms ?? DEFAULT_FTS_MATCH_MAX_TERMS;
  const segments = raw.split(TOKEN_SPLIT).filter((s) => s.length > 0);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (FTS_RESERVED.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(lower);
    if (terms.length >= maxTerms) break;
  }
  if (terms.length === 0) return null;
  return terms.map((t) => `"${escapePhraseToken(t)}"`).join(' OR ');
}
