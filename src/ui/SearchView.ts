import { ItemView, WorkspaceLeaf } from "obsidian";
import { SEARCH_VIEW_TYPE } from "../constants";
import type { HierarchicalSearchResult } from "../types";
import type { SearchPaneState } from "./SearchPaneModel";
import { SearchPaneModel } from "./SearchPaneModel";

export class SearchView extends ItemView {
  private readonly model: SearchPaneModel;
  private unsubscribe: (() => void) | null = null;
  private queryInputEl: HTMLElement | null = null;
  private topKInputEl: HTMLElement | null = null;
  private minScoreInputEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;

  public constructor(leaf: WorkspaceLeaf, model: SearchPaneModel) {
    super(leaf);
    this.model = model;
  }

  public getViewType(): string {
    return SEARCH_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Obsidian AI Search";
  }

  public async onOpen(): Promise<void> {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: "obsidian-ai-search-view" });
    root.createEl("h2", { text: "Semantic Search" });

    const controls = root.createDiv({ cls: "obsidian-ai-search-controls" });
    const queryRow = controls.createDiv({ cls: "obsidian-ai-search-controls__query" });
    this.queryInputEl = queryRow.createEl("input", { cls: "obsidian-ai-search-input" });
    this.setInputValue(this.queryInputEl, this.model.getState().query);
    this.setInputPlaceholder(this.queryInputEl, "Search notes by meaning");

    const searchButton = queryRow.createEl("button", {
      cls: "obsidian-ai-search-submit",
      text: "Search"
    });
    this.bindEvent(searchButton, "click", async () => {
      await this.model.search(this.readInputValue(this.queryInputEl));
    });

    const qualityRow = controls.createDiv({ cls: "obsidian-ai-search-controls__quality" });
    qualityRow.createEl("span", { text: "Top-k" });
    this.topKInputEl = qualityRow.createEl("input", { cls: "obsidian-ai-search-topk" });
    this.setInputType(this.topKInputEl, "number");
    this.bindEvent(this.topKInputEl, "input", () => {
      this.model.setTopK(this.parseInteger(this.readInputValue(this.topKInputEl)));
    });

    qualityRow.createEl("span", { text: "Min score" });
    this.minScoreInputEl = qualityRow.createEl("input", { cls: "obsidian-ai-search-minscore" });
    this.setInputType(this.minScoreInputEl, "number");
    this.bindEvent(this.minScoreInputEl, "input", () => {
      this.model.setMinScore(this.parseOptionalNumber(this.readInputValue(this.minScoreInputEl)));
    });

    this.statusEl = root.createEl("p", { cls: "obsidian-ai-search-status" });
    this.resultsEl = root.createDiv({ cls: "obsidian-ai-search-results" });

    this.unsubscribe = this.model.subscribe((state) => {
      this.renderState(state);
    });
  }

  public async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  private renderState(state: SearchPaneState): void {
    this.setInputValue(this.queryInputEl, state.query);
    this.setInputValue(this.topKInputEl, String(state.controls.topK));
    this.setInputValue(this.minScoreInputEl, state.controls.minScore !== undefined ? String(state.controls.minScore) : "");

    if (!this.statusEl || !this.resultsEl) {
      return;
    }

    this.statusEl.setText(this.renderStatusText(state));
    this.resultsEl.empty();

    if (state.results.length === 0) {
      return;
    }

    for (const result of state.results) {
      this.renderHierarchicalResult(result);
    }
  }

  private renderHierarchicalResult(result: HierarchicalSearchResult): void {
    if (!this.resultsEl) {
      return;
    }

    const card = this.resultsEl.createDiv({ cls: "obsidian-ai-search-result" });

    if (result.headingTrail.length > 0) {
      card.createEl("p", {
        cls: "obsidian-ai-search-result__trail",
        text: result.headingTrail.join(" > ")
      });
    }

    const title = result.headingTrail.length > 0
      ? `${result.noteTitle} — ${result.headingTrail[result.headingTrail.length - 1]}`
      : result.noteTitle;
    const action = card.createEl("span", {
      cls: "obsidian-ai-search-result__action",
      text: title
    });
    this.bindEvent(action, "click", async () => {
      await this.model.openResult(result);
    });

    card.createEl("p", {
      cls: "obsidian-ai-search-result__path",
      text: result.notePath
    });

    if (result.parentSummary) {
      card.createEl("p", {
        cls: "obsidian-ai-search-result__summary",
        text: result.parentSummary
      });
    }

    if (result.matchedContent) {
      card.createEl("p", {
        cls: "obsidian-ai-search-result__snippet",
        text: result.matchedContent
      });
    }

    if (result.siblingSnippet) {
      card.createEl("p", {
        cls: "obsidian-ai-search-result__sibling",
        text: result.siblingSnippet
      });
    }

    const scoreRow = card.createDiv();
    scoreRow.createEl("span", {
      cls: "obsidian-ai-search-result__score",
      text: `Score: ${result.score.toFixed(3)}`
    });
  }

  private renderStatusText(state: SearchPaneState): string {
    if (state.status === "loading") {
      return "Searching semantic index...";
    }
    if (state.status === "error") {
      return state.errorMessage ?? "Search failed.";
    }
    if (state.status === "empty") {
      return `No semantic matches found for "${state.query}".`;
    }
    if (state.status === "success") {
      return `Showing ${state.results.length} semantic matches.`;
    }
    return "Enter a query and run semantic search.";
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

  private setInputType(element: HTMLElement | null, value: string): void {
    const target = element as unknown as { type?: string };
    if (target) {
      target.type = value;
    }
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

  private parseInteger(rawValue: string): number {
    const parsedValue = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsedValue) ? parsedValue : Number.NaN;
  }

  private parseOptionalNumber(rawValue: string): number | undefined {
    if (rawValue.trim().length === 0) {
      return undefined;
    }
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }
}
