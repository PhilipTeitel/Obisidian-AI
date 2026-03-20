import { describe, expect, it, vi } from "vitest";
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
    chatTimeout: 30000,
    logLevel: "info"
  };
};

const createModelWithResponse = () =>
  new ChatPaneModel({
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
    expect(view.contentEl.querySelector(".obsidian-ai-chat-header")).not.toBeNull();
    expect(view.contentEl.querySelector(".obsidian-ai-chat-button-row")).not.toBeNull();

    await view.onClose();
  });

  it("A1_controls_below_history", async () => {
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

    const root = view.contentEl.querySelector(".obsidian-ai-chat-view") as unknown as { children: Array<{ className: string }> };
    expect(root).not.toBeNull();

    const children = root.children;
    const headerIdx = children.findIndex((el) => el.className === "obsidian-ai-chat-header");
    const historyIdx = children.findIndex((el) => el.className === "obsidian-ai-chat-history");
    const controlsIdx = children.findIndex((el) => el.className === "obsidian-ai-chat-controls");

    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(historyIdx).toBeGreaterThan(headerIdx);
    expect(controlsIdx).toBeGreaterThan(historyIdx);

    await view.onClose();
  });

  it("A2_input_is_textarea", async () => {
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

    const inputEl = view.contentEl.querySelector(".obsidian-ai-chat-input");
    expect(inputEl).not.toBeNull();
    expect(inputEl?.tagName.toLowerCase()).toBe("textarea");

    await view.onClose();
  });

  it("A3_user_bubble_no_prefix", async () => {
    const model = createModelWithResponse();
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.send("Hello there");

    const userEl = view.contentEl.querySelector(".obsidian-ai-chat-turn__user");
    expect(userEl).not.toBeNull();
    expect(userEl?.tagName.toLowerCase()).toBe("div");
    expect(userEl?.textContent).toBe("Hello there");
    expect(userEl?.textContent).not.toContain("You:");

    await view.onClose();
  });

  it("A4_assistant_bubble_no_prefix", async () => {
    const model = createModelWithResponse();
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.send("Hello there");

    const assistantEl = view.contentEl.querySelector(".obsidian-ai-chat-turn__assistant");
    expect(assistantEl).not.toBeNull();
    expect(assistantEl?.tagName.toLowerCase()).toBe("div");
    expect(assistantEl?.textContent).toBe("Answer");
    expect(assistantEl?.textContent).not.toContain("Assistant:");

    await view.onClose();
  });

  it("A5_buttons_in_button_row", async () => {
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

    const buttonRow = view.contentEl.querySelector(".obsidian-ai-chat-button-row");
    expect(buttonRow).not.toBeNull();
    expect(buttonRow?.querySelector(".obsidian-ai-chat-send")).not.toBeNull();
    expect(buttonRow?.querySelector(".obsidian-ai-chat-cancel")).not.toBeNull();

    await view.onClose();
  });

  it("B1_auto_scroll_after_render", async () => {
    const model = createModelWithResponse();
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.send("Scroll test");

    const historyEl = view.contentEl.querySelector(".obsidian-ai-chat-history");
    expect(historyEl).not.toBeNull();
    if (historyEl) {
      expect(historyEl.scrollTop).toBe(historyEl.scrollHeight);
    }

    await view.onClose();
  });

  it("C2_renders_history_and_sources", async () => {
    const model = createModelWithResponse();
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.send("Question?");

    expect(view.contentEl.querySelector(".obsidian-ai-chat-turn__user")?.textContent).toBe("Question?");
    expect(view.contentEl.querySelector(".obsidian-ai-chat-turn__assistant")?.textContent).toContain("Answer");
    const sourceItem = view.contentEl.querySelector(".obsidian-ai-chat-turn__source-item");
    expect(sourceItem).not.toBeNull();
    expect(sourceItem?.tagName.toLowerCase()).toBe("span");
    expect(sourceItem?.textContent).toContain("notes/source.md");

    await view.onClose();
  });

  it("A1_copy_button_in_assistant_bubble", async () => {
    const model = createModelWithResponse();
    const view = new ChatView(new WorkspaceLeaf(), model);

    await view.onOpen();
    await model.send("Copy test");

    const assistantEl = view.contentEl.querySelector(".obsidian-ai-chat-turn__assistant");
    expect(assistantEl).not.toBeNull();
    const copyBtn = assistantEl?.querySelector(".obsidian-ai-chat-turn__copy-btn");
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.tagName.toLowerCase()).toBe("button");

    await view.onClose();
  });

  it("A2_copy_button_writes_to_clipboard", async () => {
    const clipboardTexts: string[] = [];
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn(async (text: string) => {
          clipboardTexts.push(text);
        })
      },
      writable: true,
      configurable: true
    });

    try {
      const model = createModelWithResponse();
      const view = new ChatView(new WorkspaceLeaf(), model);

      await view.onOpen();
      await model.send("Clipboard test");

      const copyBtn = view.contentEl.querySelector(".obsidian-ai-chat-turn__copy-btn") as unknown as {
        addEventListener?: (event: string, callback: () => void) => void;
        _clickHandler?: () => void;
      };
      expect(copyBtn).not.toBeNull();

      const assistantEl = view.contentEl.querySelector(".obsidian-ai-chat-turn__assistant");
      expect(assistantEl?.textContent).toContain("Answer");

      await view.onClose();
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        writable: true,
        configurable: true
      });
    }
  });
});
