import { ItemView, WorkspaceLeaf } from "obsidian";
import { CHAT_VIEW_TYPE } from "../constants";
import type { ChatPaneState } from "./ChatPaneModel";
import { ChatPaneModel } from "./ChatPaneModel";

export class ChatView extends ItemView {
  private readonly model: ChatPaneModel;
  private unsubscribe: (() => void) | null = null;
  private draftInputEl: HTMLElement | null = null;
  private sendButtonEl: HTMLElement | null = null;
  private cancelButtonEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private historyEl: HTMLElement | null = null;

  public constructor(leaf: WorkspaceLeaf, model: ChatPaneModel) {
    super(leaf);
    this.model = model;
  }

  public getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Obsidian AI Chat";
  }

  public async onOpen(): Promise<void> {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: "obsidian-ai-chat-view" });
    root.createEl("h2", { text: "Vault Chat" });

    const controls = root.createDiv({ cls: "obsidian-ai-chat-controls" });
    this.draftInputEl = controls.createEl("input", { cls: "obsidian-ai-chat-input" });
    this.setInputPlaceholder(this.draftInputEl, "Ask a question grounded in your vault");
    this.bindEvent(this.draftInputEl, "input", () => {
      this.model.setDraft(this.readInputValue(this.draftInputEl));
    });

    this.sendButtonEl = controls.createEl("button", {
      cls: "obsidian-ai-chat-send",
      text: "Send"
    });
    this.bindEvent(this.sendButtonEl, "click", async () => {
      await this.model.send(this.readInputValue(this.draftInputEl));
    });

    this.cancelButtonEl = controls.createEl("button", {
      cls: "obsidian-ai-chat-cancel",
      text: "Cancel"
    });
    this.bindEvent(this.cancelButtonEl, "click", () => {
      this.model.cancelStreaming();
    });

    this.statusEl = root.createEl("p", { cls: "obsidian-ai-chat-status" });
    this.historyEl = root.createDiv({ cls: "obsidian-ai-chat-history" });

    this.unsubscribe = this.model.subscribe((state) => {
      this.renderState(state);
    });
  }

  public async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  private renderState(state: ChatPaneState): void {
    this.setInputValue(this.draftInputEl, state.draft);
    this.setButtonDisabled(this.sendButtonEl, !state.canSend);
    this.setButtonDisabled(this.cancelButtonEl, !state.canCancel);

    if (!this.statusEl || !this.historyEl) {
      return;
    }

    this.statusEl.setText(this.renderStatusText(state));
    this.historyEl.empty();

    for (const turn of state.turns) {
      const turnEl = this.historyEl.createDiv({ cls: "obsidian-ai-chat-turn" });
      turnEl.createEl("p", {
        cls: "obsidian-ai-chat-turn__user",
        text: `You: ${turn.userMessage}`
      });
      turnEl.createEl("p", {
        cls: "obsidian-ai-chat-turn__assistant",
        text: `Assistant: ${turn.assistantMessage || "(waiting...)"}`
      });
      turnEl.createEl("p", {
        cls: "obsidian-ai-chat-turn__status",
        text: `Status: ${turn.status}`
      });
      if (turn.errorMessage) {
        turnEl.createEl("p", {
          cls: "obsidian-ai-chat-turn__error",
          text: turn.errorMessage
        });
      }
      if (turn.sources.length > 0) {
        const sourcesEl = turnEl.createDiv({ cls: "obsidian-ai-chat-turn__sources" });
        sourcesEl.createEl("p", { text: "Sources:" });
        for (const source of turn.sources) {
          const heading = source.heading ? ` - ${source.heading}` : "";
          sourcesEl.createEl("p", {
            cls: "obsidian-ai-chat-turn__source-item",
            text: `${source.notePath}${heading}: ${source.snippet}`
          });
        }
      }
    }
  }

  private renderStatusText(state: ChatPaneState): string {
    if (state.status === "streaming") {
      return "Generating response...";
    }
    if (state.status === "error") {
      return state.errorMessage ?? "Chat failed.";
    }
    if (state.turns.length === 0) {
      return "Ask a question to start chat.";
    }
    return "Chat ready.";
  }

  private bindEvent(
    element: HTMLElement | null,
    eventName: string,
    handler: () => void | Promise<void>
  ): void {
    const target = element as unknown as {
      addEventListener?: (event: string, callback: () => void | Promise<void>) => void;
    };
    target.addEventListener?.(eventName, handler);
  }

  private setInputPlaceholder(element: HTMLElement | null, value: string): void {
    const target = element as unknown as { placeholder?: string };
    if (target) {
      target.placeholder = value;
    }
  }

  private readInputValue(element: HTMLElement | null): string {
    const target = element as unknown as { value?: unknown };
    return typeof target?.value === "string" ? target.value : "";
  }

  private setInputValue(element: HTMLElement | null, value: string): void {
    const target = element as unknown as { value?: string };
    if (target) {
      target.value = value;
    }
  }

  private setButtonDisabled(element: HTMLElement | null, disabled: boolean): void {
    const target = element as unknown as { disabled?: boolean };
    if (target) {
      target.disabled = disabled;
    }
  }
}
