import { describe, expect, it } from "vitest";
import { COMMAND_IDS, SEARCH_VIEW_TYPE } from "../../constants";
import type { SearchRequest, SearchResult } from "../../types";
import { SearchPaneModel } from "../../ui/SearchPaneModel";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";

interface PluginWithSearchPaneModel {
  searchPaneModel: SearchPaneModel | null;
}

const getSearchPaneModel = (harness: ReturnType<typeof createPluginTestHarness>): SearchPaneModel => {
  const model = (harness.plugin as unknown as PluginWithSearchPaneModel).searchPaneModel;
  if (!model) {
    throw new Error("Expected search pane model after onload.");
  }
  return model;
};

const patchSearch = (
  harness: ReturnType<typeof createPluginTestHarness>,
  impl: (request: SearchRequest) => Promise<SearchResult[]>
): void => {
  const runtimeServices = harness.getRuntimeServices();
  if (!runtimeServices) {
    throw new Error("Expected runtime services after onload.");
  }
  runtimeServices.searchService.search = impl;
};

describe("semantic search selection command integration", () => {
  it("A1_empty_selection_guard", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    harness.appHarness.clearSelection();
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    expect(harness.appHarness.getNoticeMessages()).toContain(
      "Select note text before running Semantic search selection."
    );
    await harness.runOnunload();
  });

  it("A2_selection_sets_query_and_reveals_search_view", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    harness.appHarness.setSelection("  Find related references in this paragraph.  ");
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    const model = getSearchPaneModel(harness);
    expect(model.getState().query).toBe("Find related references in this paragraph.");
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(1);

    await harness.runOnunload();
  });

  it("A3_selection_uses_shared_search_pipeline", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    const requests: SearchRequest[] = [];
    patchSearch(harness, async (request) => {
      requests.push(request);
      return [];
    });

    harness.appHarness.setSelection("Selection query");
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    expect(requests).toHaveLength(1);
    expect(requests[0].query).toBe("Selection query");
    await harness.runOnunload();
  });

  it("B1_selection_failure_notice_path", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    patchSearch(harness, async () => {
      throw new Error("forced search failure");
    });

    harness.appHarness.setSelection("Selection query");
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices.some((message) => message.includes("Retry the action"))).toBe(true);

    await harness.runOnunload();
  });

  it("B1_selection_reuses_quality_controls", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    const requests: SearchRequest[] = [];
    patchSearch(harness, async (request) => {
      requests.push(request);
      return [];
    });

    const model = getSearchPaneModel(harness);
    model.setTopK(13);
    model.setMinScore(0.44);

    harness.appHarness.setSelection("Selection query");
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    expect(requests[0]).toEqual({
      query: "Selection query",
      topK: 13,
      minScore: 0.44
    });

    await harness.runOnunload();
  });

  it("A3_runtime_open_link_invocation", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    patchSearch(harness, async () => [
      {
        chunkId: "chunk-nav",
        score: 0.88,
        notePath: "notes/target.md",
        noteTitle: "Target",
        heading: "Relevant Section",
        snippet: "Snippet",
        tags: []
      }
    ]);

    harness.appHarness.setSelection("Selection query");
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    const model = getSearchPaneModel(harness);
    const didOpen = await model.openResultByIndex(0);

    expect(didOpen).toBe(true);
    expect(harness.appHarness.getOpenedLinks()).toEqual([
      {
        linktext: "notes/target.md#Relevant Section",
        sourcePath: "",
        newLeaf: true
      }
    ]);

    await harness.runOnunload();
  });
});
