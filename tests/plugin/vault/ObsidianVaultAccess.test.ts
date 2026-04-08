import { describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { ObsidianVaultAccess } from '@src/plugin/vault/ObsidianVaultAccess.js';
import type { ObsidianAISettings } from '@src/plugin/settings/types.js';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';

function fakeFile(path: string): TFile {
  return { path, extension: 'md' } as TFile;
}

describe('ObsidianVaultAccess', () => {
  it('A1_list_all', async () => {
    const settings: ObsidianAISettings = {
      ...DEFAULT_SETTINGS,
      indexedFolders: [],
      excludedFolders: [],
    };
    const vault = {
      getMarkdownFiles: () => [fakeFile('a.md'), fakeFile('b/c.md')],
    } as unknown as Vault;
    const access = new ObsidianVaultAccess(vault, () => settings);
    const files = await access.listFiles([]);
    expect(files.map((f) => f.path).sort()).toEqual(['a.md', 'b/c.md']);
  });

  it('A2_excluded', async () => {
    const settings: ObsidianAISettings = {
      ...DEFAULT_SETTINGS,
      indexedFolders: [],
      excludedFolders: ['b'],
    };
    const vault = {
      getMarkdownFiles: () => [fakeFile('a.md'), fakeFile('b/c.md')],
    } as unknown as Vault;
    const access = new ObsidianVaultAccess(vault, () => settings);
    const files = await access.listFiles([]);
    expect(files.map((f) => f.path)).toEqual(['a.md']);
  });

  it('A3_fallback_to_adapter_list_when_markdown_cache_empty', async () => {
    const settings: ObsidianAISettings = {
      ...DEFAULT_SETTINGS,
      indexedFolders: [],
      excludedFolders: [],
    };
    const vault = {
      getMarkdownFiles: () => [],
      getFiles: () => [],
      getAllLoadedFiles: () => [],
      adapter: {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            files: ['a.md', 'ignore.txt'],
            folders: ['b'],
          })
          .mockResolvedValueOnce({
            files: ['b/c.md'],
            folders: [],
          }),
      },
    } as unknown as Vault;
    const access = new ObsidianVaultAccess(vault, () => settings);
    const files = await access.listFiles([]);
    expect(files.map((f) => f.path)).toEqual(['a.md', 'b/c.md']);
  });

  it('A4_fallback_to_getFiles_when_markdown_cache_empty', async () => {
    const settings: ObsidianAISettings = {
      ...DEFAULT_SETTINGS,
      indexedFolders: [],
      excludedFolders: [],
    };
    const vault = {
      getMarkdownFiles: () => [],
      getFiles: () => [fakeFile('a.md'), { path: 'asset.png', extension: 'png' } as TFile],
      getAllLoadedFiles: () => [],
      adapter: {
        list: vi.fn(),
      },
    } as unknown as Vault;
    const access = new ObsidianVaultAccess(vault, () => settings);
    const files = await access.listFiles([]);
    expect(files.map((f) => f.path)).toEqual(['a.md']);
  });

  it('readFile_uses_cachedRead', async () => {
    const settings = { ...DEFAULT_SETTINGS };
    const cachedRead = vi.fn().mockResolvedValue('# body');
    const vault = {
      getAbstractFileByPath: () => fakeFile('x.md'),
      cachedRead,
    } as unknown as Vault;
    const access = new ObsidianVaultAccess(vault, () => settings);
    await expect(access.readFile('x.md')).resolves.toBe('# body');
    expect(cachedRead).toHaveBeenCalled();
  });
});
