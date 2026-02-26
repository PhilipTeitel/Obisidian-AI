import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import type { SearchRequest, SearchResult } from "../types";

export const SEARCH_TOP_K_DEFAULT = 8;
export const SEARCH_TOP_K_MIN = 1;
export const SEARCH_TOP_K_MAX = 25;
export const SEARCH_MIN_SCORE_MIN = 0;
export const SEARCH_MIN_SCORE_MAX = 1;

export type SearchPaneStatus = "idle" | "loading" | "success" | "empty" | "error";

export interface SearchQualityControls {
  topK: number;
  minScore?: number;
}

export interface SearchPaneState {
  query: string;
  status: SearchPaneStatus;
  results: SearchResult[];
  controls: SearchQualityControls;
  errorMessage?: string;
}

interface SearchPaneModelDeps {
  runSearch: (request: SearchRequest) => Promise<SearchResult[]>;
  openResult: (result: SearchResult) => Promise<void>;
  notify: (message: string) => void;
  defaults?: Partial<SearchQualityControls>;
}

type SearchPaneListener = (state: SearchPaneState) => void;

const clampTopK = (value: number): number => {
  if (!Number.isFinite(value)) {
    return SEARCH_TOP_K_DEFAULT;
  }
  const rounded = Math.round(value);
  return Math.max(SEARCH_TOP_K_MIN, Math.min(SEARCH_TOP_K_MAX, rounded));
};

const normalizeMinScore = (value: number | undefined): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(SEARCH_MIN_SCORE_MIN, Math.min(SEARCH_MIN_SCORE_MAX, value));
};

const logger = createRuntimeLogger("SearchPaneModel");

export class SearchPaneModel {
  private state: SearchPaneState;
  private readonly deps: SearchPaneModelDeps;
  private readonly listeners = new Set<SearchPaneListener>();

  public constructor(deps: SearchPaneModelDeps) {
    this.deps = deps;
    this.state = {
      query: "",
      status: "idle",
      results: [],
      controls: {
        topK: clampTopK(deps.defaults?.topK ?? SEARCH_TOP_K_DEFAULT),
        minScore: normalizeMinScore(deps.defaults?.minScore)
      }
    };
  }

  public getState(): SearchPaneState {
    return {
      ...this.state,
      results: [...this.state.results],
      controls: { ...this.state.controls }
    };
  }

  public subscribe(listener: SearchPaneListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setQuery(query: string): void {
    this.updateState({
      query,
      errorMessage: undefined
    });
  }

  public setTopK(topK: number): void {
    this.updateState({
      controls: {
        ...this.state.controls,
        topK: clampTopK(topK)
      }
    });
  }

  public setMinScore(minScore: number | undefined): void {
    this.updateState({
      controls: {
        ...this.state.controls,
        minScore: normalizeMinScore(minScore)
      }
    });
  }

  public async search(queryInput?: string): Promise<SearchResult[]> {
    const operationLogger = logger.withOperation();
    const normalizedQuery = (queryInput ?? this.state.query).trim();
    if (normalizedQuery.length === 0) {
      operationLogger.info({
        event: "search.pane.query.skipped",
        message: "Search pane query skipped because input is empty."
      });
      this.updateState({
        query: normalizedQuery,
        status: "idle",
        results: [],
        errorMessage: undefined
      });
      return [];
    }

    this.updateState({
      query: normalizedQuery,
      status: "loading",
      errorMessage: undefined
    });
    const searchStartedAt = Date.now();
    operationLogger.info({
      event: "search.pane.query.start",
      message: "Search pane query started.",
      context: {
        queryLength: normalizedQuery.length,
        topK: this.state.controls.topK,
        minScore: this.state.controls.minScore
      }
    });

    try {
      const request = this.buildSearchRequest(normalizedQuery);
      const results = await this.deps.runSearch(request);
      const status = results.length === 0 ? "empty" : "success";
      this.updateState({
        status,
        results,
        errorMessage: undefined
      });
      operationLogger.info({
        event: "search.pane.query.completed",
        message: "Search pane query completed.",
        context: {
          resultCount: results.length,
          status,
          elapsedMs: Date.now() - searchStartedAt
        }
      });
      return results;
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "SearchPaneModel.search",
        queryLength: normalizedQuery.length,
        topK: this.state.controls.topK,
        minScore: this.state.controls.minScore
      });
      this.updateState({
        status: "error",
        errorMessage: normalized.userMessage
      });
      operationLogger.error({
        event: "search.pane.query.failed",
        message: "Search pane query failed.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      this.deps.notify(normalized.userMessage);
      return [];
    }
  }

  public async searchFromSelection(selection: string): Promise<SearchResult[]> {
    const normalizedSelection = selection.trim();
    if (normalizedSelection.length === 0) {
      this.updateState({
        query: "",
        status: "idle",
        results: [],
        errorMessage: undefined
      });
      return [];
    }
    return this.search(normalizedSelection);
  }

  public async openResult(result: SearchResult): Promise<void> {
    const operationLogger = logger.withOperation();
    operationLogger.info({
      event: "search.pane.open_result.start",
      message: "Opening search result from pane.",
      context: {
        notePath: result.notePath,
        heading: result.heading
      }
    });
    try {
      await this.deps.openResult(result);
      operationLogger.info({
        event: "search.pane.open_result.completed",
        message: "Opened search result from pane.",
        context: {
          notePath: result.notePath,
          heading: result.heading
        }
      });
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "SearchPaneModel.openResult",
        notePath: result.notePath,
        heading: result.heading
      });
      operationLogger.error({
        event: "search.pane.open_result.failed",
        message: "Failed to open search result from pane.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      this.deps.notify(normalized.userMessage);
    }
  }

  public async openResultByIndex(index: number): Promise<boolean> {
    const result = this.state.results[index];
    if (!result) {
      return false;
    }
    await this.openResult(result);
    return true;
  }

  private buildSearchRequest(query: string): SearchRequest {
    return {
      query,
      topK: clampTopK(this.state.controls.topK),
      minScore: normalizeMinScore(this.state.controls.minScore)
    };
  }

  private updateState(patch: Partial<SearchPaneState>): void {
    this.state = {
      ...this.state,
      ...patch,
      controls: patch.controls ? { ...patch.controls } : this.state.controls,
      results: patch.results ? [...patch.results] : this.state.results
    };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
