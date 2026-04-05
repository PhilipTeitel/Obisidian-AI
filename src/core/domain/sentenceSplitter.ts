/**
 * Rule-based sentence splitting for CHK-2. Abbreviations listed in CHK-2 Y7 must not
 * produce false breaks after their trailing period.
 *
 * Canonical paragraph body: trim **trailing** newlines only; internal newlines preserved.
 */
export function canonicalParagraphBody(text: string): string {
  return text.replace(/\n+$/u, '');
}

const ABBREV_PATTERN =
  /(?:e\.g\.|i\.e\.|Dr\.|Mr\.|Mrs\.|Ms\.|vs\.|etc\.)/giu;

/** Placeholder for `.` inside protected abbreviations (not valid in Markdown text). */
const DOT_PLACEHOLDER = '\uE999';

function maskAbbreviationDots(text: string): string {
  return text.replace(ABBREV_PATTERN, (m) =>
    m.replace(/\./gu, DOT_PLACEHOLDER),
  );
}

function unmaskAbbreviationDots(text: string): string {
  return text.split(DOT_PLACEHOLDER).join('.');
}

/**
 * Partition `canonicalParagraphBody(text)` into contiguous segments so
 * `splitIntoSentences(text).join('') === canonicalParagraphBody(text)`.
 */
export function splitIntoSentences(text: string): string[] {
  const canon = canonicalParagraphBody(text);
  if (!canon) return [];

  const masked = maskAbbreviationDots(canon);
  const sentences: string[] = [];
  let start = 0;
  let i = 0;
  while (i < masked.length) {
    const c = masked[i]!;
    if (c === '.' || c === '!' || c === '?') {
      const next = masked[i + 1];
      if (next === undefined || /\s/u.test(next)) {
        let end = i + 1;
        while (end < masked.length && /\s/u.test(masked[end]!)) {
          end++;
        }
        const piece = unmaskAbbreviationDots(masked.slice(start, end));
        if (piece) sentences.push(piece);
        start = end;
        i = end;
        continue;
      }
    }
    i++;
  }
  const last = unmaskAbbreviationDots(masked.slice(start));
  if (last) sentences.push(last);

  return sentences.length > 0 ? sentences : [canon];
}
