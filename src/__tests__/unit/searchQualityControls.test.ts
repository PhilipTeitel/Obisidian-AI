import { describe, expect, it } from "vitest";
import type { SearchRequest } from "../../types";
import {
  SEARCH_TOP_K_DEFAULT,
  SEARCH_TOP_K_MAX,
  SEARCH_TOP_K_MIN,
  SearchPaneModel
} from "../../ui/SearchPaneModel";

describe("search quality controls", () => {
  it("A1_default_control_values", () => {
    const model = new SearchPaneModel({
      runSearch: async () => [],
      openResult: async () => undefined,
      notify: () => undefined
    });

    expect(model.getState().controls).toEqual({
      topK: SEARCH_TOP_K_DEFAULT,
      minScore: undefined
    });
  });

  it("A2_clamps_invalid_control_values", () => {
    const model = new SearchPaneModel({
      runSearch: async () => [],
      openResult: async () => undefined,
      notify: () => undefined
    });

    model.setTopK(0);
    expect(model.getState().controls.topK).toBe(SEARCH_TOP_K_MIN);

    model.setTopK(200);
    expect(model.getState().controls.topK).toBe(SEARCH_TOP_K_MAX);

    model.setTopK(Number.NaN);
    expect(model.getState().controls.topK).toBe(SEARCH_TOP_K_DEFAULT);

    model.setMinScore(-0.25);
    expect(model.getState().controls.minScore).toBe(0);

    model.setMinScore(2.5);
    expect(model.getState().controls.minScore).toBe(1);

    model.setMinScore(Number.NaN);
    expect(model.getState().controls.minScore).toBeUndefined();
  });

  it("B2_control_updates_affect_subsequent_searches", async () => {
    const requests: SearchRequest[] = [];
    const model = new SearchPaneModel({
      runSearch: async (request) => {
        requests.push(request);
        return [];
      },
      openResult: async () => undefined,
      notify: () => undefined
    });

    model.setTopK(3);
    model.setMinScore(0.2);
    await model.search("first");

    model.setTopK(12);
    model.setMinScore(undefined);
    await model.search("second");

    expect(requests[0]).toEqual({
      query: "first",
      topK: 3,
      minScore: 0.2
    });
    expect(requests[1]).toEqual({
      query: "second",
      topK: 12,
      minScore: undefined
    });
  });
});
