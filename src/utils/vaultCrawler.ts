import type { ChunkerInput } from "../types";

export interface VaultMarkdownFileLike {
  path: string;
  basename: string;
  stat: {
    mtime: number;
  };
}

export interface VaultLike {
  getMarkdownFiles(): VaultMarkdownFileLike[];
  cachedRead(file: VaultMarkdownFileLike): Promise<string>;
}

export interface CrawlVaultMarkdownNotesInput {
  vault: VaultLike;
  indexedFolders: string[];
  excludedFolders: string[];
}

const normalizePathSeparators = (value: string): string => value.replace(/\\/g, "/");

const collapseSlashes = (value: string): string => value.replace(/\/+/g, "/");

export const normalizeVaultFolderPath = (folder: string): string | null => {
  const trimmed = collapseSlashes(normalizePathSeparators(folder.trim()));
  if (!trimmed || trimmed === "/") {
    return null;
  }

  const withoutLeading = trimmed.replace(/^\/+/, "");
  const withoutTrailing = withoutLeading.replace(/\/+$/, "");
  return withoutTrailing.length > 0 ? withoutTrailing : null;
};

const normalizeFolderScope = (folders: string[], fallbackToRoot: boolean): string[] => {
  const normalized = new Set<string>();
  for (const folder of folders) {
    const normalizedPath = normalizeVaultFolderPath(folder);
    if (normalizedPath) {
      normalized.add(normalizedPath);
    }
  }

  if (normalized.size === 0 && fallbackToRoot) {
    return ["/"];
  }

  return [...normalized].sort((left, right) => left.localeCompare(right));
};

export const normalizeVaultNotePath = (notePath: string): string => {
  const normalized = collapseSlashes(normalizePathSeparators(notePath.trim())).replace(/^\/+/, "");
  return normalized.replace(/\/+$/, "");
};

export const isPathInFolderScope = (notePath: string, folder: string): boolean => {
  if (folder === "/") {
    return true;
  }
  return notePath === folder || notePath.startsWith(`${folder}/`);
};

const isIncludedByScope = (notePath: string, includeFolders: string[], excludeFolders: string[]): boolean => {
  const isIncluded = includeFolders.some((folder) => isPathInFolderScope(notePath, folder));
  if (!isIncluded) {
    return false;
  }
  const isExcluded = excludeFolders.some((folder) => isPathInFolderScope(notePath, folder));
  return !isExcluded;
};

export const crawlVaultMarkdownNotes = async (
  input: CrawlVaultMarkdownNotesInput
): Promise<ChunkerInput[]> => {
  const includeFolders = normalizeFolderScope(input.indexedFolders, true);
  const excludeFolders = normalizeFolderScope(input.excludedFolders, false);

  const files = [...input.vault.getMarkdownFiles()].sort((left, right) =>
    normalizeVaultNotePath(left.path).localeCompare(normalizeVaultNotePath(right.path))
  );
  const notes: ChunkerInput[] = [];

  for (const file of files) {
    const notePath = normalizeVaultNotePath(file.path);
    if (!isIncludedByScope(notePath, includeFolders, excludeFolders)) {
      continue;
    }

    const markdown = await input.vault.cachedRead(file);
    notes.push({
      notePath,
      noteTitle: file.basename,
      markdown,
      updatedAt: file.stat.mtime
    });
  }

  return notes;
};
