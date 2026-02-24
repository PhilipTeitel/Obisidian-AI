import { describe, expect, it } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { SearchPaneModel } from "../../ui/SearchPaneModel";
import { SearchView } from "../../ui/SearchView";

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

  it("A3_renders_result_metadata", async () => {
    const model = new SearchPaneModel({
      runSearch: async () => [
        {
          chunkId: "chunk-1",
          score: 0.923,
          notePath: "notes/semantic.md",
          noteTitle: "Semantic",
          heading: "Heading",
          snippet: "Snippet preview",
          tags: ["ai"]
        }
      ],
      openResult: async () => undefined,
      notify: () => undefined
    });
    const view = new SearchView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.search("semantic query");

    expect(view.contentEl.querySelector(".obsidian-ai-search-result__action")?.textContent).toContain("Semantic");
    expect(view.contentEl.querySelector(".obsidian-ai-search-result__path")?.textContent).toBe("notes/semantic.md");
    expect(view.contentEl.querySelector(".obsidian-ai-search-result__snippet")?.textContent).toBe("Snippet preview");
    expect(view.contentEl.querySelector(".obsidian-ai-search-result__score")?.textContent).toContain("0.923");

    await view.onClose();
  });
});
