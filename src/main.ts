import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { bootstrapRuntimeServices } from "./bootstrap/bootstrapRuntimeServices";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "./constants";
import { normalizeRuntimeError } from "./errors/normalizeRuntimeError";
import { createRuntimeLogger } from "./logging/runtimeLogger";
import { DEFAULT_SETTINGS, ObsidianAISettingTab, snapshotSettings } from "./settings";
import {
  migratePersistedSettings,
  normalizeSettingsSnapshot,
  serializeSettingsForPersistence
} from "./settingsSchema";
import type {
  JobSnapshot,
  JobStatus,
  JobType,
  ObsidianAISettings,
  ObsidianAIViewType,
  RuntimeServices,
  SearchResult
} from "./types";
import { ChatPaneModel } from "./ui/ChatPaneModel";
import { ChatView } from "./ui/ChatView";
import { SearchPaneModel } from "./ui/SearchPaneModel";
import { SearchView } from "./ui/SearchView";
import { ProgressSlideout } from "./ui/ProgressSlideout";
import { buildSearchResultLink } from "./ui/searchNavigation";

const SETTINGS_STORAGE_KEY = "settings";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export default class ObsidianAIPlugin extends Plugin {
  public settings: ObsidianAISettings = { ...DEFAULT_SETTINGS };
  private readonly logger = createRuntimeLogger("ObsidianAIPlugin");
  private runtimeServices: RuntimeServices | null = null;
  private runtimeServicesBootstrapPromise: Promise<RuntimeServices> | null = null;
  private searchPaneModel: SearchPaneModel | null = null;
  private chatPaneModel: ChatPaneModel | null = null;
  private progressSlideout: ProgressSlideout | null = null;
  private progressHideTimeoutId: number | null = null;

  public async onload(): Promise<void> {
    await this.loadSettings();
    this.logger.log({
      level: "info",
      event: "plugin.onload.start",
      message: "Plugin onload started."
    });

    this.searchPaneModel = new SearchPaneModel({
      runSearch: async (request) => (await this.ensureRuntimeServices()).searchService.search(request),
      openResult: async (result) => {
        await this.openSearchResult(result);
      },
      notify: (message) => {
        new Notice(message);
      }
    });

    this.chatPaneModel = new ChatPaneModel({
      runChat: (request) => this.runChatWithLazyRuntime(request),
      runSourceSearch: async (query) => {
        return (await this.ensureRuntimeServices()).searchService.search({
          query,
          topK: 5
        });
      },
      getSettings: () => snapshotSettings(this.settings),
      notify: (message) => {
        new Notice(message);
      }
    });

    this.registerView(SEARCH_VIEW_TYPE, (leaf: WorkspaceLeaf) => new SearchView(leaf, this.requireSearchPaneModel()));
    this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChatView(leaf, this.requireChatPaneModel()));

    this.progressSlideout = new ProgressSlideout(this.app);
    this.progressSlideout.setStatus(
      this.createProgressSnapshot({
        type: "index-changes",
        status: "succeeded",
        label: "Idle",
        detail: "No indexing tasks are running."
      })
    );

    this.registerCommands();
    this.addSettingTab(new ObsidianAISettingTab(this.app, this));
    this.logger.log({
      level: "info",
      event: "plugin.onload.succeeded",
      message: "Plugin onload completed with lazy runtime bootstrap."
    });
  }

  public async onunload(): Promise<void> {
    this.logger.log({
      level: "info",
      event: "plugin.onunload.start",
      message: "Plugin onunload started."
    });

    if (this.progressHideTimeoutId !== null) {
      window.clearTimeout(this.progressHideTimeoutId);
      this.progressHideTimeoutId = null;
    }

    await this.detachViewLeaves(SEARCH_VIEW_TYPE);
    await this.detachViewLeaves(CHAT_VIEW_TYPE);

    this.progressSlideout?.dispose();
    this.progressSlideout = null;

    const pendingBootstrap = this.runtimeServicesBootstrapPromise;
    let servicesToDispose = this.runtimeServices;
    this.runtimeServices = null;
    this.runtimeServicesBootstrapPromise = null;
    this.searchPaneModel = null;
    this.chatPaneModel = null;
    if (!servicesToDispose && pendingBootstrap) {
      try {
        servicesToDispose = await pendingBootstrap;
      } catch {
        servicesToDispose = null;
      }
    }
    try {
      await servicesToDispose?.dispose();
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "plugin.onunload",
        phase: "dispose"
      });
      this.logger.log({
        level: "error",
        event: "plugin.onunload.dispose_failed",
        message: "Failed to dispose runtime services.",
        domain: normalized.domain,
        context: {
          operation: "plugin.onunload",
          phase: "dispose"
        },
        error: normalized
      });
    }

    this.logger.log({
      level: "info",
      event: "plugin.onunload.succeeded",
      message: "Plugin onunload completed."
    });
  }

  public async loadSettings(): Promise<void> {
    const loadedData = await this.loadData();
    const settingsPayload = isRecord(loadedData) && SETTINGS_STORAGE_KEY in loadedData ? loadedData[SETTINGS_STORAGE_KEY] : loadedData;
    const migratedSettings = migratePersistedSettings(settingsPayload);
    this.settings = snapshotSettings(normalizeSettingsSnapshot(migratedSettings, DEFAULT_SETTINGS));
  }

  public async saveSettings(): Promise<void> {
    const normalizedSettings = snapshotSettings(normalizeSettingsSnapshot(this.settings, DEFAULT_SETTINGS));
    this.settings = normalizedSettings;

    const loadedData = await this.loadData();
    const persistedRoot = isRecord(loadedData) ? { ...loadedData } : {};
    persistedRoot[SETTINGS_STORAGE_KEY] = serializeSettingsForPersistence(normalizedSettings);
    await this.saveData(persistedRoot);
  }

  private registerCommands(): void {
    this.addCommand({
      id: COMMAND_IDS.REINDEX_VAULT,
      name: COMMAND_NAMES.REINDEX_VAULT,
      callback: async () => {
        await this.runIndexCommand(COMMAND_NAMES.REINDEX_VAULT, "reindex-vault", async () => {
          return (await this.ensureRuntimeServices()).indexingService.reindexVault({
            onProgress: (snapshot) => {
              this.setProgressStatus(snapshot);
            }
          });
        });
      }
    });

    this.addCommand({
      id: COMMAND_IDS.INDEX_CHANGES,
      name: COMMAND_NAMES.INDEX_CHANGES,
      callback: async () => {
        await this.runIndexCommand(COMMAND_NAMES.INDEX_CHANGES, "index-changes", async () => {
          return (await this.ensureRuntimeServices()).indexingService.indexChanges({
            onProgress: (snapshot) => {
              this.setProgressStatus(snapshot);
            }
          });
        });
      }
    });

    this.addCommand({
      id: COMMAND_IDS.SEARCH_SELECTION,
      name: COMMAND_NAMES.SEARCH_SELECTION,
      callback: async () => {
        const selection = this.getActiveSelection();
        if (!selection) {
          new Notice("Select note text before running Semantic search selection.");
          return;
        }

        await this.activateView(SEARCH_VIEW_TYPE);
        await this.requireSearchPaneModel().searchFromSelection(selection);
      }
    });

    this.addCommand({
      id: COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE,
      name: COMMAND_NAMES.OPEN_SEMANTIC_SEARCH_PANE,
      callback: async () => {
        await this.activateView(SEARCH_VIEW_TYPE);
      }
    });
  }

  private async runIndexCommand(
    commandName: string,
    jobType: JobType,
    runCommand: () => Promise<JobSnapshot>
  ): Promise<void> {
    this.logger.log({
      level: "info",
      event: "plugin.command.start",
      message: `Starting command: ${commandName}.`,
      context: {
        command: commandName,
        jobType
      }
    });
    try {
      const snapshot = await runCommand();
      this.setProgressStatus(snapshot);
      this.logger.log({
        level: "info",
        event: "plugin.command.succeeded",
        message: `Command completed: ${commandName}.`,
        context: {
          command: commandName,
          jobType,
          status: snapshot.status
        }
      });
      new Notice(this.createCompletionNotice(commandName, snapshot));
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "plugin.command",
        command: commandName,
        jobType
      });
      this.logger.log({
        level: "error",
        event: "plugin.command.failed",
        message: `Failed to run command: ${commandName}.`,
        domain: normalized.domain,
        context: {
          operation: "plugin.command",
          command: commandName,
          jobType
        },
        error: normalized
      });
      this.setProgressStatus(
        this.createProgressSnapshot({
          type: jobType,
          status: "failed",
          label: commandName,
          detail: "Runtime command failed.",
          errorMessage: normalized.message
        })
      );
      const recoveryHint = this.extractRecoveryHint(normalized.message);
      new Notice(recoveryHint ? `${normalized.userMessage} ${recoveryHint}` : normalized.userMessage);
    }
  }

  private extractRecoveryHint(message: string): string | null {
    const marker = "Recovery action:";
    const markerIndex = message.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }
    const hint = message.slice(markerIndex).trim();
    return hint.length > 0 ? hint : null;
  }

  private async ensureRuntimeServices(): Promise<RuntimeServices> {
    if (this.runtimeServices) {
      return this.runtimeServices;
    }
    if (this.runtimeServicesBootstrapPromise) {
      return this.runtimeServicesBootstrapPromise;
    }

    this.logger.log({
      level: "info",
      event: "plugin.runtime.bootstrap_start",
      message: "Initializing runtime services on first use."
    });

    const bootstrapStart = Date.now();
    this.runtimeServicesBootstrapPromise = (async () => {
      try {
        const bootstrapResult = await bootstrapRuntimeServices({
          app: this.app,
          plugin: this,
          getSettings: () => snapshotSettings(this.settings),
          notify: (message) => {
            new Notice(message);
          }
        });
        this.runtimeServices = bootstrapResult.services;
        this.logger.log({
          level: "info",
          event: "plugin.runtime.bootstrap_succeeded",
          message: "Runtime services bootstrapped on demand.",
          context: {
            initializedServices: bootstrapResult.initializationOrder.length,
            elapsedMs: Date.now() - bootstrapStart
          }
        });
        return bootstrapResult.services;
      } catch (error: unknown) {
        const normalized = normalizeRuntimeError(error, {
          operation: "plugin.runtime.ensure",
          phase: "bootstrap"
        });
        this.logger.log({
          level: "error",
          event: "plugin.runtime.bootstrap_failed",
          message: "Failed to initialize runtime services on demand.",
          domain: normalized.domain,
          context: {
            operation: "plugin.runtime.ensure",
            phase: "bootstrap"
          },
          error: normalized
        });
        new Notice(normalized.userMessage);
        throw normalized;
      } finally {
        this.runtimeServicesBootstrapPromise = null;
      }
    })();

    return this.runtimeServicesBootstrapPromise;
  }

  private async *runChatWithLazyRuntime(request: Parameters<RuntimeServices["chatService"]["chat"]>[0]) {
    const runtimeServices = await this.ensureRuntimeServices();
    for await (const event of runtimeServices.chatService.chat(request)) {
      yield event;
    }
  }

  private requireSearchPaneModel(): SearchPaneModel {
    if (!this.searchPaneModel) {
      throw new Error("Search pane model is unavailable.");
    }
    return this.searchPaneModel;
  }

  private requireChatPaneModel(): ChatPaneModel {
    if (!this.chatPaneModel) {
      throw new Error("Chat pane model is unavailable.");
    }
    return this.chatPaneModel;
  }

  private async openSearchResult(result: SearchResult): Promise<void> {
    const target = buildSearchResultLink(result);
    const workspace = this.app.workspace as unknown as {
      openLinkText?: (linktext: string, sourcePath: string, newLeaf?: boolean) => Promise<void> | void;
    };
    if (typeof workspace.openLinkText !== "function") {
      throw new Error(`Workspace navigation is unavailable for search target: ${target}`);
    }
    await workspace.openLinkText(target, "", true);
  }

  private setProgressStatus(snapshot: JobSnapshot): void {
    if (!this.progressSlideout) {
      return;
    }

    this.progressSlideout.setStatus(snapshot);
    this.progressSlideout.show();

    if (this.progressHideTimeoutId !== null) {
      window.clearTimeout(this.progressHideTimeoutId);
      this.progressHideTimeoutId = null;
    }

    if (snapshot.status === "running" || snapshot.status === "queued") {
      return;
    }

    this.progressHideTimeoutId = window.setTimeout(() => {
      this.progressSlideout?.hide();
      this.progressHideTimeoutId = null;
    }, 1800);
  }

  private createCompletionNotice(commandName: string, snapshot: JobSnapshot): string {
    const detail = snapshot.progress.detail?.trim();
    if (!detail) {
      return `${commandName} completed.`;
    }
    return `${commandName} completed. ${detail}`;
  }

  private createProgressSnapshot(params: {
    type: JobType;
    status: JobStatus;
    label: string;
    detail: string;
    errorMessage?: string;
  }): JobSnapshot {
    const now = Date.now();
    const isFinished = params.status === "succeeded" || params.status === "failed" || params.status === "cancelled";
    return {
      id: `${params.type}:${now}`,
      type: params.type,
      status: params.status,
      startedAt: now,
      finishedAt: isFinished ? now : undefined,
      progress: {
        completed: 0,
        total: 0,
        label: params.label,
        detail: params.detail
      },
      errorMessage: params.errorMessage
    };
  }

  private getActiveSelection(): string | null {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const rawSelection = activeMarkdownView?.editor?.getSelection() ?? "";
    const selection = rawSelection.trim();
    return selection.length > 0 ? selection : null;
  }

  private async activateView(viewType: ObsidianAIViewType): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(viewType)[0];
    const leaf = existingLeaf ?? this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      new Notice(`Unable to open ${viewType}.`);
      return;
    }

    await leaf.setViewState({
      type: viewType,
      active: true
    });

    this.app.workspace.revealLeaf(leaf);
  }

  private async detachViewLeaves(viewType: ObsidianAIViewType): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    for (const leaf of leaves) {
      try {
        await leaf.detach();
      } catch (error: unknown) {
        const normalized = normalizeRuntimeError(error, {
          operation: "plugin.detachViewLeaves",
          viewType
        });
        this.logger.log({
          level: "error",
          event: "plugin.view.detach_failed",
          message: `Failed to detach leaf for ${viewType}.`,
          domain: normalized.domain,
          context: {
            operation: "plugin.detachViewLeaves",
            viewType
          },
          error: normalized
        });
      }
    }
  }
}
