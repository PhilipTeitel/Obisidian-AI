import type { AgentServiceContract, RuntimeBootstrapContext } from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";

export interface AgentServiceDeps {
  app: RuntimeBootstrapContext["app"];
  getSettings: RuntimeBootstrapContext["getSettings"];
  notify: RuntimeBootstrapContext["notify"];
}

interface VaultCreateAdapter {
  create: (path: string, content: string) => Promise<unknown>;
  modify?: (file: unknown, content: string) => Promise<unknown>;
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

const logger = createRuntimeLogger("AgentService");

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
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    operationLogger.info({
      event: "agent.create_note.start",
      message: "Agent createNote started.",
      context: {
        requestedPath: path,
        contentLength: content.length
      }
    });

    const settings = this.deps.getSettings();
    const maxNoteSize = settings.maxGeneratedNoteSize;
    if (content.length > maxNoteSize) {
      operationLogger.warn({
        event: "agent.create_note.blocked_size",
        message: "Agent createNote blocked by max note size.",
        context: {
          maxNoteSize,
          contentLength: content.length
        }
      });
      this.deps.notify(`Create note blocked: content exceeds max size (${maxNoteSize}).`);
      return;
    }

    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) {
      operationLogger.warn({
        event: "agent.create_note.blocked_invalid_path",
        message: "Agent createNote blocked due to invalid path.",
        context: {
          requestedPath: path
        }
      });
      this.deps.notify(`Create note blocked: invalid path "${path}".`);
      return;
    }

    if (!isPathAllowed(normalizedPath, settings.agentOutputFolders)) {
      operationLogger.warn({
        event: "agent.create_note.blocked_disallowed_path",
        message: "Agent createNote blocked due to disallowed path.",
        context: {
          normalizedPath
        }
      });
      this.deps.notify(`Create note blocked: path "${normalizedPath}" is outside allowed output folders.`);
      return;
    }

    const vault = this.deps.app.vault as unknown as VaultCreateAdapter;
    if (typeof vault.create !== "function") {
      throw new Error("Vault create API is unavailable.");
    }

    if (typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath(normalizedPath)) {
      operationLogger.warn({
        event: "agent.create_note.blocked_exists",
        message: "Agent createNote blocked because target already exists.",
        context: {
          normalizedPath
        }
      });
      this.deps.notify(`Create note blocked: file already exists at "${normalizedPath}".`);
      return;
    }

    await vault.create(normalizedPath, content);
    operationLogger.info({
      event: "agent.create_note.completed",
      message: "Agent createNote completed.",
      context: {
        normalizedPath,
        elapsedMs: Date.now() - startedAt
      }
    });
    this.deps.notify(`Created note: ${normalizedPath}`);
  }

  public async updateNote(path: string, content: string): Promise<void> {
    if (this.disposed) {
      throw new Error("AgentService is disposed.");
    }
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    operationLogger.info({
      event: "agent.update_note.start",
      message: "Agent updateNote started.",
      context: {
        requestedPath: path,
        contentLength: content.length
      }
    });

    const settings = this.deps.getSettings();
    const maxNoteSize = settings.maxGeneratedNoteSize;
    if (content.length > maxNoteSize) {
      operationLogger.warn({
        event: "agent.update_note.blocked_size",
        message: "Agent updateNote blocked by max note size.",
        context: {
          maxNoteSize,
          contentLength: content.length
        }
      });
      this.deps.notify(`Update note blocked: content exceeds max size (${maxNoteSize}).`);
      return;
    }

    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) {
      operationLogger.warn({
        event: "agent.update_note.blocked_invalid_path",
        message: "Agent updateNote blocked due to invalid path.",
        context: {
          requestedPath: path
        }
      });
      this.deps.notify(`Update note blocked: invalid path "${path}".`);
      return;
    }

    if (!isPathAllowed(normalizedPath, settings.agentOutputFolders)) {
      operationLogger.warn({
        event: "agent.update_note.blocked_disallowed_path",
        message: "Agent updateNote blocked due to disallowed path.",
        context: {
          normalizedPath
        }
      });
      this.deps.notify(`Update note blocked: path "${normalizedPath}" is outside allowed output folders.`);
      return;
    }

    const vault = this.deps.app.vault as unknown as VaultCreateAdapter;
    if (typeof vault.getAbstractFileByPath !== "function") {
      throw new Error("Vault lookup API is unavailable.");
    }
    if (typeof vault.modify !== "function") {
      throw new Error("Vault modify API is unavailable.");
    }

    const existingFile = vault.getAbstractFileByPath(normalizedPath);
    if (!existingFile) {
      operationLogger.warn({
        event: "agent.update_note.blocked_missing_file",
        message: "Agent updateNote blocked because target file does not exist.",
        context: {
          normalizedPath
        }
      });
      this.deps.notify(`Update note blocked: file does not exist at "${normalizedPath}".`);
      return;
    }

    await vault.modify(existingFile, content);
    operationLogger.info({
      event: "agent.update_note.completed",
      message: "Agent updateNote completed.",
      context: {
        normalizedPath,
        elapsedMs: Date.now() - startedAt
      }
    });
    this.deps.notify(`Updated note: ${normalizedPath}`);
  }
}
