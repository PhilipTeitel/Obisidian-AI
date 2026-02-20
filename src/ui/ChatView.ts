import { ItemView, WorkspaceLeaf } from "obsidian";
import { CHAT_VIEW_TYPE } from "../constants";

export class ChatView extends ItemView {
  public constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  public getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Obsidian AI Chat";
  }

  public async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Vault Chat" });
    this.contentEl.createEl("p", {
      text: "Chat shell only (FND-2). Streaming and provider calls are not implemented yet."
    });
  }

  public async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
