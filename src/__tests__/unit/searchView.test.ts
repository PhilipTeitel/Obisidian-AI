import { describe, expect, it } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { SearchPaneModel } from "../../ui/SearchPaneModel";
import { SearchView } from "../../ui/SearchView";

const createResultModel = () =>
  new SearchPaneModel({
    runSearch: async () => [
      {
        nodeId: "chunk-1",
        score: 0.923,
        notePath: "notes/semantic.md",
        noteTitle: "Semantic",
        headingTrail: ["Heading"],
        matchedContent: "Snippet preview",
        parentSummary: "",
        siblingSnippet: "",
        tags: ["ai"]
      }
    ],
    openResult: async () => undefined,
    notify: () => undefined
  });

describe("SearchView", () => {
  it("A1_renders_search_input_and_actions", async () => {
    const model = new SearchPaneModel({
      runSearch: async () => [],
      openResult: async () => undefined,
      notify: () => undefined
    });
    const view = new SearchView(new WorkspaceLeaf(), model);

    await view.onOpen();

    expect(view.contentEl.querySelector(".obsidian-ai-search-input")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-search-submit")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-search-status")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-search-topk")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-search-minscore")).not.toBeNull();

    await view.onClose();
  });

  it("A1_title_renders_as_span_with_click", async () => {
    const model = createResultModel();
    const view = new SearchView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.search("semantic query");

    const actionEl = view.contentEl.querySelector(".obsidian-ai-search-result__action");
    expect(actionEl).not.toBeNull();
    expect(actionEl?.tagName.toLowerCase()).toBe("span");
    expect(actionEl?.textContent).toContain("Semantic");
    expect(actionEl?.textContent).toContain("\u2014");
    expect(actionEl?.textContent).toContain("Heading");

    await view.onClose();
  });

  it("A3_renders_result_metadata", async () => {
    const model = createResultModel();
    const view = new SearchView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.search("semantic query");

    expect(view.contentEl.querySelector(".obsidian-ai-search-result__action")?.textContent).toContain("Semantic");
    expect(view.contentEl.querySelector(".obsidian-ai-search-result__path")?.textContent).toBe("notes/semantic.md");
    expect(view.contentEl.querySelector(".obsidian-ai-search-result__snippet")?.textContent).toBe("Snippet preview");
    expect(view.contentEl.querySelector(".obsidian-ai-search-result__score")?.textContent).toContain("0.923");

    await view.onClose();
  });

  it("A4_score_renders_as_span_pill", async () => {
    const model = createResultModel();
    const view = new SearchView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.search("semantic query");

    const scoreEl = view.contentEl.querySelector(".obsidian-ai-search-result__score");
    expect(scoreEl).not.toBeNull();
    expect(scoreEl?.tagName.toLowerCase()).toBe("span");
    expect(scoreEl?.textContent).toContain("0.923");

    await view.onClose();
  });
});
