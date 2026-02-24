import type { AgentServiceContract, RuntimeBootstrapContext } from "../types";

export interface AgentServiceDeps {
  app: RuntimeBootstrapContext["app"];
  getSettings: RuntimeBootstrapContext["getSettings"];
  notify: RuntimeBootstrapContext["notify"];
}

interface VaultCreateAdapter {
  create: (path: string, content: string) => Promise<unknown>;
  getAbstractFileByPath?: (path: string) => unknown;
}

const normalizeVaultPath = (path: string): string | null => {
  let normalized = path.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/+/g, "/");
  if (normalized.startsWith("/") || normalized.length === 0 || normalized.endsWith("/")) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return normalized;
};

const normalizeAllowedFolder = (folder: string): string | null => {
  let normalized = folder.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/+/g, "/");
  if (normalized === "/") {
    return "";
  }
  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.length === 0) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return normalized;
};

const isPathAllowed = (path: string, allowedFolders: string[]): boolean => {
  const normalizedFolders = allowedFolders
    .map((folder) => normalizeAllowedFolder(folder))
    .filter((folder): folder is string => folder !== null);
  if (normalizedFolders.length === 0) {
    return false;
  }
  for (const folder of normalizedFolders) {
    if (folder.length === 0 || path === folder || path.startsWith(`${folder}/`)) {
      return true;
    }
  }
  return false;
};

export class AgentService implements AgentServiceContract {
  private disposed = false;
  private readonly deps: AgentServiceDeps;

  public constructor(deps: AgentServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async createNote(path: string, content: string): Promise<void> {
    if (this.disposed) {
      throw new Error("AgentService is disposed.");
    }

    const settings = this.deps.getSettings();
    const maxNoteSize = settings.maxGeneratedNoteSize;
    if (content.length > maxNoteSize) {
      this.deps.notify(`Create note blocked: content exceeds max size (${maxNoteSize}).`);
      return;
    }

    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) {
      this.deps.notify(`Create note blocked: invalid path "${path}".`);
      return;
    }

    if (!isPathAllowed(normalizedPath, settings.agentOutputFolders)) {
      this.deps.notify(`Create note blocked: path "${normalizedPath}" is outside allowed output folders.`);
      return;
    }

    const vault = this.deps.app.vault as unknown as VaultCreateAdapter;
    if (typeof vault.create !== "function") {
      throw new Error("Vault create API is unavailable.");
    }

    if (typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath(normalizedPath)) {
      this.deps.notify(`Create note blocked: file already exists at "${normalizedPath}".`);
      return;
    }

    await vault.create(normalizedPath, content);
    this.deps.notify(`Created note: ${normalizedPath}`);
  }

  public async updateNote(path: string, content: string): Promise<void> {
    if (this.disposed) {
      throw new Error("AgentService is disposed.");
    }

    const maxNoteSize = this.deps.getSettings().maxGeneratedNoteSize;
    if (content.length > maxNoteSize) {
      this.deps.notify(`Update note blocked: content exceeds max size (${maxNoteSize}).`);
      return;
    }

    this.deps.notify(`Update note is not implemented yet for path: ${path}`);
  }
}
