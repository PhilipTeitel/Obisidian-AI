import type { ParsedTag } from './types.js';
import { normalizeTagString } from './frontmatterTags.js';

interface Exclusion {
  start: number;
  end: number;
}

function mergeExclusions(ranges: Exclusion[]): Exclusion[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Exclusion[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

function inExclusion(pos: number, ex: Exclusion[]): boolean {
  return ex.some((r) => pos >= r.start && pos < r.end);
}

/**
 * Fenced ``` blocks and inline `code` spans (CHK-5 Y5).
 */
function buildCodeExclusions(text: string): Exclusion[] {
  const ex: Exclusion[] = [];
  for (const m of text.matchAll(/```[\s\S]*?```/gu)) {
    if (m.index !== undefined) {
      ex.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  for (const m of text.matchAll(/`[^`\n]+`/gu)) {
    if (m.index === undefined) continue;
    if (inExclusion(m.index, ex)) continue;
    ex.push({ start: m.index, end: m.index + m[0].length });
  }
  return mergeExclusions(ex);
}

const TAG_RE = /#([a-zA-Z0-9_/-]+)/gu;

/**
 * Obsidian-style `#tag` tokens outside code fences / inline code (CHK-5).
 */
export function extractInlineTagsFromText(text: string, nodeId: string): ParsedTag[] {
  const ex = buildCodeExclusions(text);
  const seen = new Set<string>();
  const out: ParsedTag[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const idx = m.index ?? 0;
    if (inExclusion(idx, ex)) continue;
    const raw = m[0]!;
    const norm = normalizeTagString(raw);
    if (!norm) continue;
    const key = `${nodeId}\0${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ nodeId, tag: norm, source: 'inline' });
  }
  return out;
}
