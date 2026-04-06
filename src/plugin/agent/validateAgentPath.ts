function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * AGT-1: vault-relative path must stay under configured agent roots (prefix match) with no `..` segments.
 */
export function validateAgentPath(vaultPath: string, allowedRoots: string[]): string | null {
  const p = normalizePath(vaultPath);
  if (!p) return 'Path is empty';
  if (p.split('/').some((seg) => seg === '..')) return 'Path must not contain ..';
  const roots = allowedRoots.map((r) => normalizePath(r)).filter((r) => r.length > 0);
  if (roots.length === 0) return 'No agent output folders configured';
  const ok = roots.some((r) => p === r || p.startsWith(`${r}/`));
  if (!ok) return 'Path outside agent output folders';
  return null;
}
