import { ItemView, WorkspaceLeaf } from "obsidian";
import { SEARCH_VIEW_TYPE } from "../constants";

export class SearchView extends ItemView {
  public constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  public getViewType(): string {
    return SEARCH_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Obsidian AI Search";
  }

  public async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Semantic Search" });
    this.contentEl.createEl("p", {
      text: "Semantic search shell only (FND-2). Search execution is not implemented yet."
    });
  }

  public async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
