import { describe, expect, it } from "vitest";
import type { SearchRequest, SearchResult } from "../../types";
import { SEARCH_TOP_K_DEFAULT, SearchPaneModel } from "../../ui/SearchPaneModel";

const createResult = (overrides?: Partial<SearchResult>): SearchResult => {
  return {
    chunkId: "chunk-1",
    score: 0.91,
    notePath: "notes/example.md",
    noteTitle: "Example",
    heading: "Section",
    snippet: "Example snippet",
    tags: ["ai"],
    ...overrides
  };
};

describe("SearchPaneModel", () => {
  it("A1_pane_state_contract", () => {
    const model = new SearchPaneModel({
      runSearch: async () => [],
      openResult: async () => undefined,
      notify: () => undefined
    });

    const state = model.getState();
    expect(state.query).toBe("");
    expect(state.status).toBe("idle");
    expect(state.results).toEqual([]);
    expect(state.controls).toEqual({
      topK: SEARCH_TOP_K_DEFAULT,
      minScore: undefined
    });
  });

  it("A2_query_executes_search_service", async () => {
    const requests: SearchRequest[] = [];
    const model = new SearchPaneModel({
      runSearch: async (request) => {
        requests.push(request);
        return [];
      },
      openResult: async () => undefined,
      notify: () => undefined
    });

    await model.search("  semantic retrieval  ");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      query: "semantic retrieval",
      topK: SEARCH_TOP_K_DEFAULT,
      minScore: undefined
    });
    expect(model.getState().status).toBe("empty");
  });

  it("A3_success_state_preserves_result_order", async () => {
    const first = createResult({ chunkId: "chunk-a", noteTitle: "A", score: 0.9 });
    const second = createResult({ chunkId: "chunk-b", noteTitle: "B", score: 0.8 });
    const model = new SearchPaneModel({
      runSearch: async () => [first, second],
      openResult: async () => undefined,
      notify: () => undefined
    });

    await model.search("ordered query");

    const state = model.getState();
    expect(state.status).toBe("success");
    expect(state.results.map((result) => result.chunkId)).toEqual(["chunk-a", "chunk-b"]);
  });

  it("B1_failed_search_sets_error_state", async () => {
    const notices: string[] = [];
    const model = new SearchPaneModel({
      runSearch: async () => {
        throw new Error("provider failed");
      },
      openResult: async () => undefined,
      notify: (message) => {
        notices.push(message);
      }
    });

    await model.search("error query");

    const state = model.getState();
    expect(state.status).toBe("error");
    expect(state.errorMessage).toBeTruthy();
    expect(notices).toHaveLength(1);
  });

  it("A1_open_result_delegates_to_runtime", async () => {
    const opened: SearchResult[] = [];
    const expected = createResult();
    const model = new SearchPaneModel({
      runSearch: async () => [expected],
      openResult: async (result) => {
        opened.push(result);
      },
      notify: () => undefined
    });

    await model.search("open query");
    const didOpen = await model.openResultByIndex(0);

    expect(didOpen).toBe(true);
    expect(opened).toEqual([expected]);
  });

  it("B1_open_result_failure_is_reported", async () => {
    const notices: string[] = [];
    const expected = createResult();
    const model = new SearchPaneModel({
      runSearch: async () => [expected],
      openResult: async () => {
        throw new Error("navigation failed");
      },
      notify: (message) => {
        notices.push(message);
      }
    });

    await model.search("open query");
    const didOpen = await model.openResultByIndex(0);

    expect(didOpen).toBe(true);
    expect(notices).toHaveLength(1);
    expect(model.getState().status).toBe("success");
  });

  it("A3_request_includes_normalized_controls", async () => {
    const requests: SearchRequest[] = [];
    const model = new SearchPaneModel({
      runSearch: async (request) => {
        requests.push(request);
        return [];
      },
      openResult: async () => undefined,
      notify: () => undefined
    });

    model.setTopK(100);
    model.setMinScore(9);
    await model.search("first");

    model.setTopK(-3);
    model.setMinScore(-5);
    await model.search("second");

    expect(requests[0]).toEqual({
      query: "first",
      topK: 25,
      minScore: 1
    });
    expect(requests[1]).toEqual({
      query: "second",
      topK: 1,
      minScore: 0
    });
  });
});
