import { App } from "obsidian";
import type { ProgressSlideoutStatus } from "../types";

const PROGRESS_SHELLOUT_CLASS = "obsidian-ai-progress-slideout";

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

    this.setStatus({
      label: "Idle",
      detail: "No indexing tasks are running.",
      isActive: false
    });
    this.hide();
  }

  public show(): void {
    this.containerEl.style.display = "block";
  }

  public hide(): void {
    this.containerEl.style.display = "none";
  }

  public setStatus(status: ProgressSlideoutStatus): void {
    this.statusEl.setText(status.label);
    this.detailEl.setText(status.detail);
    this.containerEl.dataset.state = status.isActive ? "active" : "idle";
  }

  public dispose(): void {
    this.containerEl.remove();
  }
}
