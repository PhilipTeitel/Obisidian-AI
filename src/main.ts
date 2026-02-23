import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { bootstrapRuntimeServices } from "./bootstrap/bootstrapRuntimeServices";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "./constants";
import { normalizeRuntimeError } from "./errors/normalizeRuntimeError";
import { createRuntimeLogger } from "./logging/runtimeLogger";
import { DEFAULT_SETTINGS, ObsidianAISettingTab, snapshotSettings } from "./settings";
import type {
  JobSnapshot,
  JobStatus,
  JobType,
  ObsidianAISettings,
  ObsidianAIViewType,
  RuntimeServices
} from "./types";
import { ChatView } from "./ui/ChatView";
import { SearchView } from "./ui/SearchView";
import { ProgressSlideout } from "./ui/ProgressSlideout";

export default class ObsidianAIPlugin extends Plugin {
  public settings: ObsidianAISettings = { ...DEFAULT_SETTINGS };
  private readonly logger = createRuntimeLogger("ObsidianAIPlugin");
  private runtimeServices: RuntimeServices | null = null;
  private progressSlideout: ProgressSlideout | null = null;
  private progressHideTimeoutId: number | null = null;

  public async onload(): Promise<void> {
    await this.loadSettings();
    this.logger.log({
      level: "info",
      event: "plugin.onload.start",
      message: "Plugin onload started."
    });

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
        event: "plugin.onload.bootstrap_succeeded",
        message: "Runtime services bootstrapped.",
        context: {
          initializedServices: bootstrapResult.initializationOrder.length
        }
      });
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "plugin.onload",
        phase: "bootstrap"
      });
      this.logger.log({
        level: "error",
        event: "plugin.onload.bootstrap_failed",
        message: "Failed to bootstrap runtime services.",
        domain: normalized.domain,
        context: {
          operation: "plugin.onload",
          phase: "bootstrap"
        },
        error: normalized
      });
      new Notice(normalized.userMessage);
      throw normalized;
    }

    this.registerView(SEARCH_VIEW_TYPE, (leaf: WorkspaceLeaf) => new SearchView(leaf));
    this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChatView(leaf));

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
      message: "Plugin onload completed."
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

    const servicesToDispose = this.runtimeServices;
    this.runtimeServices = null;
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
    const loadedData = (await this.loadData()) as Partial<ObsidianAISettings> | null;
    this.settings = snapshotSettings({
      ...DEFAULT_SETTINGS,
      ...loadedData
    });
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private registerCommands(): void {
    this.addCommand({
      id: COMMAND_IDS.REINDEX_VAULT,
      name: COMMAND_NAMES.REINDEX_VAULT,
      callback: async () => {
        await this.runIndexCommand(COMMAND_NAMES.REINDEX_VAULT, "reindex-vault", async () => {
          return this.requireRuntimeServices().indexingService.reindexVault({
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
          return this.requireRuntimeServices().indexingService.indexChanges({
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
        await this.requireRuntimeServices().searchService.searchSelection(selection);
        new Notice("Semantic search selection is not implemented in FND-4 yet.");
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
      new Notice(normalized.userMessage);
    }
  }

  private requireRuntimeServices(): RuntimeServices {
    if (!this.runtimeServices) {
      throw new Error("Runtime services are unavailable.");
    }
    return this.runtimeServices;
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
