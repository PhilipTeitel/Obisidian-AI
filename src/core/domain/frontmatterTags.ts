import YAML from 'yaml';

/**
 * Parse simple `tags` / `tag` keys from YAML frontmatter (CHK-5).
 * Unknown / complex YAML shapes are ignored.
 */
export function parseFrontmatterForTags(frontmatter: string): string[] {
  const fm = frontmatter.trim();
  if (!fm) return [];

  let doc: unknown;
  try {
    doc = YAML.parse(fm);
  } catch {
    return [];
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return [];
  }

  const o = doc as Record<string, unknown>;
  const out: string[] = [];

  if ('tags' in o) {
    const v = o.tags;
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'string') pushNormalizedTag(out, x);
      }
    } else if (typeof v === 'string') {
      for (const part of v.split(',')) {
        pushNormalizedTag(out, part);
      }
    }
  }

  if ('tag' in o && typeof o.tag === 'string') {
    pushNormalizedTag(out, o.tag);
  }

  return dedupeTagStrings(out);
}

function pushNormalizedTag(arr: string[], raw: string): void {
  const t = normalizeTagString(raw);
  if (t) arr.push(t);
}

/** Strip leading `#`, trim; empty after trim is skipped. */
export function normalizeTagString(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  if (!s) return '';
  if (/\s/u.test(s)) return '';
  return s;
}

function dedupeTagStrings(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const key = `${t}\0`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
