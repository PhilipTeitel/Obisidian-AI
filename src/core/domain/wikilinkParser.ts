import type { ParsedCrossRef } from './types.js';

/** Vault directory: forward slashes, no trailing slash (empty = vault root). */
export function vaultDirOf(vaultPath: string): string {
  const n = vaultPath.replace(/\\/gu, '/');
  const i = n.lastIndexOf('/');
  return i === -1 ? '' : n.slice(0, i);
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/gu, '/').replace(/\/+/gu, '/');
}

/**
 * Wikilink target: append `.md` when no extension (Obsidian default); preserve paths that already end in `.md` or contain another extension.
 */
export function normalizeWikilinkTarget(inner: string): string {
  const t = inner.trim().replace(/\\/gu, '/');
  if (!t) return t;
  const base = t.split('/').pop() ?? t;
  if (base.includes('.')) return normalizeSlashes(t);
  return normalizeSlashes(`${t}.md`);
}

function shouldSkipMarkdownTarget(target: string): boolean {
  const t = target.trim();
  if (!t || t.startsWith('#')) return true;
  if (/^https?:\/\//iu.test(t)) return true;
  if (/^mailto:/iu.test(t)) return true;
  return false;
}

export function resolveMarkdownLinkTarget(target: string, vaultDir: string): string | null {
  if (shouldSkipMarkdownTarget(target)) return null;
  let path = target.trim().replace(/\\/gu, '/');
  if (path.startsWith('./')) path = path.slice(2);
  const joined = vaultDir ? `${vaultDir}/${path}` : path;
  return normalizeSlashes(joined);
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/gu;
const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/gu;

/**
 * Extract cross-references from a single node's markdown `content`.
 * Duplicate occurrences produce multiple rows (CHK-4 Y5).
 */
export function extractCrossRefsFromContent(
  content: string,
  sourceNodeId: string,
  vaultDir: string,
): ParsedCrossRef[] {
  const out: ParsedCrossRef[] = [];

  for (const m of content.matchAll(WIKILINK_RE)) {
    const inner = m[1]!.trim();
    const pipe = inner.indexOf('|');
    const targetInner = pipe === -1 ? inner : inner.slice(0, pipe).trim();
    const linkText = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null;
    if (!targetInner) continue;
    out.push({
      sourceNodeId,
      targetPath: normalizeWikilinkTarget(targetInner),
      linkText,
    });
  }

  for (const m of content.matchAll(MD_LINK_RE)) {
    const label = m[1] ?? '';
    const rawTarget = m[2]!;
    const resolved = resolveMarkdownLinkTarget(rawTarget, vaultDir);
    if (resolved === null) continue;
    out.push({
      sourceNodeId,
      targetPath: resolved,
      linkText: label.length > 0 ? label : null,
    });
  }

  return out;
}
