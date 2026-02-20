import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "./constants";
import { DEFAULT_SETTINGS, ObsidianAISettingTab } from "./settings";
import type {
  JobSnapshot,
  JobStatus,
  JobType,
  ObsidianAISettings,
  ObsidianAIViewType
} from "./types";
import { ChatView } from "./ui/ChatView";
import { SearchView } from "./ui/SearchView";
import { ProgressSlideout } from "./ui/ProgressSlideout";

export default class ObsidianAIPlugin extends Plugin {
  public settings: ObsidianAISettings = { ...DEFAULT_SETTINGS };
  private progressSlideout: ProgressSlideout | null = null;
  private progressHideTimeoutId: number | null = null;

  public async onload(): Promise<void> {
    await this.loadSettings();

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
  }

  public async onunload(): Promise<void> {
    if (this.progressHideTimeoutId !== null) {
      window.clearTimeout(this.progressHideTimeoutId);
      this.progressHideTimeoutId = null;
    }

    await this.detachViewLeaves(SEARCH_VIEW_TYPE);
    await this.detachViewLeaves(CHAT_VIEW_TYPE);

    this.progressSlideout?.dispose();
    this.progressSlideout = null;
  }

  public async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as Partial<ObsidianAISettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData
    };
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private registerCommands(): void {
    this.addCommand({
      id: COMMAND_IDS.REINDEX_VAULT,
      name: COMMAND_NAMES.REINDEX_VAULT,
      callback: () => {
        this.runPlaceholderIndexCommand(COMMAND_NAMES.REINDEX_VAULT, "reindex-vault");
      }
    });

    this.addCommand({
      id: COMMAND_IDS.INDEX_CHANGES,
      name: COMMAND_NAMES.INDEX_CHANGES,
      callback: () => {
        this.runPlaceholderIndexCommand(COMMAND_NAMES.INDEX_CHANGES, "index-changes");
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
        new Notice("Semantic search selection is not implemented in FND-2 yet.");
      }
    });
  }

  private runPlaceholderIndexCommand(commandName: string, jobType: JobType): void {
    this.setProgressStatus(
      this.createProgressSnapshot({
        type: jobType,
        status: "succeeded",
        label: commandName,
        detail: "Not implemented in FND-2."
      })
    );

    new Notice(`${commandName} is not implemented in FND-2 yet.`);
  }

  private setProgressStatus(snapshot: JobSnapshot): void {
    if (!this.progressSlideout) {
      return;
    }

    this.progressSlideout.setStatus(snapshot);
    this.progressSlideout.show();

    if (this.progressHideTimeoutId !== null) {
      window.clearTimeout(this.progressHideTimeoutId);
    }

    this.progressHideTimeoutId = window.setTimeout(() => {
      this.progressSlideout?.hide();
      this.progressHideTimeoutId = null;
    }, 1800);
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
        console.error(`Failed to detach leaf for ${viewType}`, error);
      }
    }
  }
}
