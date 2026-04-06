import type { Vault } from 'obsidian';
import type { VaultFile } from '../../core/domain/types.js';
import type { IVaultAccessPort } from '../../core/ports/IVaultAccessPort.js';
import type { ObsidianAISettings } from '../settings/types.js';

function normalizeFolder(p: string): string {
  const t = p.trim().replace(/\\/g, '/');
  if (!t) return '';
  return t.endsWith('/') ? t.slice(0, -1) : t;
}

function isUnderFolder(filePath: string, folderPrefix: string): boolean {
  const f = normalizeFolder(folderPrefix);
  if (!f) return true;
  const p = filePath === f || filePath.startsWith(`${f}/`);
  return p;
}

function isExcluded(filePath: string, excluded: string[]): boolean {
  for (const ex of excluded) {
    const e = normalizeFolder(ex);
    if (!e) continue;
    if (filePath === e || filePath.startsWith(`${e}/`)) return true;
  }
  return false;
}

/**
 * ADR-006: vault reads in the plugin only.
 */
export class ObsidianVaultAccess implements IVaultAccessPort {
  constructor(
    private readonly vault: Vault,
    private readonly settings: () => ObsidianAISettings,
  ) {}

  async listFiles(folders: string[]): Promise<VaultFile[]> {
    const s = this.settings();
    const indexed = folders.length > 0 ? folders : s.indexedFolders;
    const excluded = s.excludedFolders.map(normalizeFolder).filter(Boolean);
    const roots = (indexed.length > 0 ? indexed : ['']).map(normalizeFolder);

    const out: VaultFile[] = [];
    const md = this.vault.getMarkdownFiles();
    for (const f of md) {
      const path = f.path;
      if (isExcluded(path, excluded)) continue;
      if (indexed.length === 0) {
        out.push({ path });
        continue;
      }
      if (roots.some((r) => isUnderFolder(path, r))) {
        out.push({ path });
      }
    }
    return out;
  }

  async readFile(path: string): Promise<string> {
    const f = this.vault.getAbstractFileByPath(path);
    if (!f || typeof (f as { extension?: string }).extension !== 'string') {
      throw new Error(`ObsidianVaultAccess: not a file: ${path}`);
    }
    return this.vault.cachedRead(f as import('obsidian').TFile);
  }
}
