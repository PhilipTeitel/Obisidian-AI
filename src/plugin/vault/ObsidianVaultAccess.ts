import type { TAbstractFile, Vault } from 'obsidian';
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

type AdapterListResult = { files: string[]; folders: string[] };

function looksLikeListResult(value: unknown): value is AdapterListResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AdapterListResult>;
  return Array.isArray(v.files) && Array.isArray(v.folders);
}

function normalizeVaultPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isMarkdownPath(filePath: string): boolean {
  return normalizeVaultPath(filePath).toLowerCase().endsWith('.md');
}

function isMarkdownAbstractFile(file: TAbstractFile): file is TAbstractFile & { path: string; extension: string } {
  const ext = (file as { extension?: unknown }).extension;
  return typeof file.path === 'string' && typeof ext === 'string' && ext.toLowerCase() === 'md';
}

/**
 * ADR-006: vault reads in the plugin only.
 */
export class ObsidianVaultAccess implements IVaultAccessPort {
  constructor(
    private readonly vault: Vault,
    private readonly settings: () => ObsidianAISettings,
  ) {}

  private listFilesViaGetFiles(): VaultFile[] {
    return this.vault
      .getFiles()
      .filter((f) => typeof f.path === 'string' && isMarkdownPath(f.path))
      .map((f) => ({ path: f.path }));
  }

  private listFilesViaAllLoadedFiles(): VaultFile[] {
    return this.vault
      .getAllLoadedFiles()
      .filter(isMarkdownAbstractFile)
      .map((f) => ({ path: f.path }));
  }

  private async listFilesViaAdapter(): Promise<VaultFile[]> {
    const adapter = this.vault.adapter as {
      list?: (path: string) => Promise<AdapterListResult>;
    };
    if (typeof adapter.list !== 'function') return [];

    const out = new Set<string>();
    const pending = [''];
    while (pending.length > 0) {
      const current = pending.pop()!;
      const listed = await adapter.list(current);
      if (!looksLikeListResult(listed)) continue;
      for (const file of listed.files) {
        const normalized = normalizeVaultPath(file);
        if (isMarkdownPath(normalized)) out.add(normalized);
      }
      pending.push(...listed.folders.map(normalizeVaultPath));
    }
    return Array.from(out)
      .sort()
      .map((path) => ({ path }));
  }

  async listFiles(folders: string[]): Promise<VaultFile[]> {
    const s = this.settings();
    const indexed = folders.length > 0 ? folders : s.indexedFolders;
    const excluded = s.excludedFolders.map(normalizeFolder).filter(Boolean);
    const roots = (indexed.length > 0 ? indexed : ['']).map(normalizeFolder);

    const out: VaultFile[] = [];
    const markdownFiles = this.vault.getMarkdownFiles().map((f) => ({ path: f.path }));
    const files = markdownFiles.length > 0 ? [] : this.listFilesViaGetFiles();
    const loaded = markdownFiles.length > 0 || files.length > 0 ? [] : this.listFilesViaAllLoadedFiles();
    let md = markdownFiles.length > 0 ? markdownFiles : files.length > 0 ? files : loaded;
    if (md.length === 0) {
      md = await this.listFilesViaAdapter();
      if (md.length > 0) {
        console.warn('Obsidian AI: vault markdown enumeration used adapter fallback', {
          getMarkdownFiles: markdownFiles.length,
          getFiles: files.length,
          getAllLoadedFiles: loaded.length,
          adapterFiles: md.length,
        });
      } else {
        console.warn('Obsidian AI: vault markdown enumeration returned 0 files', {
          getMarkdownFiles: markdownFiles.length,
          getFiles: files.length,
          getAllLoadedFiles: loaded.length,
          adapterFiles: 0,
          indexedFolders: indexed,
          excludedFolders: excluded,
        });
      }
    }
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
