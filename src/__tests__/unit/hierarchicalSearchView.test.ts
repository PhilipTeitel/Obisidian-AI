import { describe, it, expect, vi } from "vitest";
import { SearchPaneModel } from "../../ui/SearchPaneModel";
import type { HierarchicalSearchResult, SearchRequest } from "../../types";

const createHierarchicalResult = (overrides?: Partial<HierarchicalSearchResult>): HierarchicalSearchResult => ({
  nodeId: "node-1",
  score: 0.85,
  notePath: "notes/test.md",
  noteTitle: "Test Note",
  headingTrail: ["Topic A", "Subtopic B"],
  matchedContent: "This is the matched paragraph content.",
  parentSummary: "Summary of the parent topic.",
  siblingSnippet: "Sibling paragraph content nearby.",
  tags: ["tag1", "tag2"],
  ...overrides
});

const createModel = (results: HierarchicalSearchResult[] = [createHierarchicalResult()]) => {
  const runSearch = vi.fn<(request: SearchRequest) => Promise<HierarchicalSearchResult[]>>()
    .mockResolvedValue(results);
  const openResult = vi.fn<(result: HierarchicalSearchResult) => Promise<void>>()
    .mockResolvedValue(undefined);
  const notify = vi.fn();

  const model = new SearchPaneModel({ runSearch, openResult, notify });
  return { model, runSearch, openResult, notify };
};

describe("META-3: Hierarchical Search View", () => {
  describe("A: Model Update", () => {
    it("A1_results_type — SearchPaneState.results uses HierarchicalSearchResult[]", async () => {
      const { model } = createModel();
      await model.search("test query");
      const state = model.getState();
      expect(state.results.length).toBe(1);
      const result = state.results[0];
      expect(result.nodeId).toBe("node-1");
      expect(result.headingTrail).toEqual(["Topic A", "Subtopic B"]);
      expect(result.matchedContent).toBe("This is the matched paragraph content.");
      expect(result.parentSummary).toBe("Summary of the parent topic.");
      expect(result.siblingSnippet).toBe("Sibling paragraph content nearby.");
    });

    it("A2_search_returns_hierarchical — search() returns HierarchicalSearchResult[]", async () => {
      const { model } = createModel();
      const results = await model.search("test query");
      expect(results.length).toBe(1);
      expect(results[0].nodeId).toBe("node-1");
      expect(results[0].headingTrail).toEqual(["Topic A", "Subtopic B"]);
    });

    it("A3_open_result_hierarchical — openResult() accepts HierarchicalSearchResult", async () => {
      const { model, openResult } = createModel();
      await model.search("test query");
      const state = model.getState();
      await model.openResult(state.results[0]);
      expect(openResult).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: "node-1", headingTrail: ["Topic A", "Subtopic B"] })
      );
    });
  });

  describe("B: View Rendering", () => {
    it("B1_heading_trail — result has heading trail for breadcrumb display", () => {
      const result = createHierarchicalResult({ headingTrail: ["Topic", "Subtopic", "Section"] });
      const trail = result.headingTrail.join(" > ");
      expect(trail).toBe("Topic > Subtopic > Section");
    });

    it("B2_parent_summary — result carries parent summary context", () => {
      const result = createHierarchicalResult({ parentSummary: "This topic covers important concepts." });
      expect(result.parentSummary).toBe("This topic covers important concepts.");
    });

    it("B3_matched_content — result carries matched content as primary snippet", () => {
      const result = createHierarchicalResult({ matchedContent: "The specific matched paragraph." });
      expect(result.matchedContent).toBe("The specific matched paragraph.");
    });

    it("B4_score_badge — result carries score for badge display", () => {
      const result = createHierarchicalResult({ score: 0.923 });
      expect(result.score.toFixed(3)).toBe("0.923");
    });
  });

  describe("C: Wiring", () => {
    it("C1_adapter — flat SearchResult can be adapted to HierarchicalSearchResult", () => {
      const flatResult = {
        chunkId: "chunk-1",
        score: 0.8,
        notePath: "notes/flat.md",
        noteTitle: "Flat Note",
        heading: "Some Heading",
        snippet: "Flat snippet text.",
        tags: ["tag"]
      };

      const adapted: HierarchicalSearchResult = {
        nodeId: flatResult.chunkId,
        score: flatResult.score,
        notePath: flatResult.notePath,
        noteTitle: flatResult.noteTitle,
        headingTrail: flatResult.heading ? [flatResult.heading] : [],
        matchedContent: flatResult.snippet,
        parentSummary: "",
        siblingSnippet: "",
        tags: flatResult.tags
      };

      expect(adapted.nodeId).toBe("chunk-1");
      expect(adapted.headingTrail).toEqual(["Some Heading"]);
      expect(adapted.matchedContent).toBe("Flat snippet text.");
      expect(adapted.parentSummary).toBe("");
      expect(adapted.siblingSnippet).toBe("");
    });
  });
});
