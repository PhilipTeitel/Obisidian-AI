import { describe, expect, it } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import type { ObsidianAISettings } from "../../types";
import { ChatPaneModel } from "../../ui/ChatPaneModel";
import { ChatView } from "../../ui/ChatView";

const createSettings = (): ObsidianAISettings => {
  return {
    embeddingProvider: "openai",
    chatProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    chatModel: "gpt-4o-mini",
    ollamaEndpoint: "http://localhost:11434",
    openaiEndpoint: "https://api.openai.com/v1",
    indexedFolders: ["/"],
    excludedFolders: [],
    agentOutputFolders: [],
    maxGeneratedNoteSize: 5000,
    chatTimeout: 30000
  };
};

describe("ChatView", () => {
  it("C1_renders_chat_controls", async () => {
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          yield { type: "done", finishReason: "stop" } as const;
        })(),
      runSourceSearch: async () => [],
      getSettings: () => createSettings(),
      notify: () => undefined
    });
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();

    expect(view.contentEl.querySelector(".obsidian-ai-chat-input")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-chat-send")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-chat-cancel")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-chat-status")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-chat-history")).not.toBeNull();

    await view.onClose();
  });

  it("C2_renders_history_and_sources", async () => {
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          yield { type: "token", text: "Answer" } as const;
          yield { type: "done", finishReason: "stop" } as const;
        })(),
      runSourceSearch: async () => [
        {
          chunkId: "chunk-1",
          score: 0.99,
          notePath: "notes/source.md",
          noteTitle: "Source",
          heading: "Heading",
          snippet: "Snippet",
          tags: []
        }
      ],
      getSettings: () => createSettings(),
      notify: () => undefined
    });
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.send("Question?");

    expect(view.contentEl.querySelector(".obsidian-ai-chat-turn__user")?.textContent).toContain("Question?");
    expect(view.contentEl.querySelector(".obsidian-ai-chat-turn__assistant")?.textContent).toContain("Answer");
    expect(view.contentEl.querySelector(".obsidian-ai-chat-turn__source-item")?.textContent).toContain("notes/source.md");

    await view.onClose();
  });
});
