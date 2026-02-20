import { App } from "obsidian";
import type { JobSnapshot } from "../types";

const PROGRESS_SHELLOUT_CLASS = "obsidian-ai-progress-slideout";

const createIdleSnapshot = (): JobSnapshot => {
  const now = Date.now();
  return {
    id: "shell-idle",
    type: "index-changes",
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    progress: {
      completed: 0,
      total: 0,
      label: "Idle",
      detail: "No indexing tasks are running."
    }
  };
};

export class ProgressSlideout {
  private readonly containerEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly detailEl: HTMLElement;

  public constructor(app: App) {
    const existingShell = app.workspace.containerEl.querySelector(`.${PROGRESS_SHELLOUT_CLASS}`);
    existingShell?.remove();

    this.containerEl = app.workspace.containerEl.createDiv({
      cls: PROGRESS_SHELLOUT_CLASS
    });
    this.containerEl.createEl("h3", { text: "Obsidian AI Progress" });
    this.statusEl = this.containerEl.createEl("p");
    this.detailEl = this.containerEl.createEl("p");

    this.setStatus(createIdleSnapshot());
    this.hide();
  }

  public show(): void {
    this.containerEl.style.display = "block";
  }

  public hide(): void {
    this.containerEl.style.display = "none";
  }

  public setStatus(snapshot: JobSnapshot): void {
    this.statusEl.setText(snapshot.progress.label);
    this.detailEl.setText(snapshot.errorMessage ?? snapshot.progress.detail ?? "");
    this.containerEl.dataset.state = snapshot.status;
  }

  public dispose(): void {
    this.containerEl.remove();
  }
}
