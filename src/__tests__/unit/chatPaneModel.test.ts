import { describe, expect, it } from "vitest";
import { ChatPaneModel } from "../../ui/ChatPaneModel";
import type { ChatRequest, ChatStreamEvent, ObsidianAISettings, SearchResult } from "../../types";

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

const createResult = (): SearchResult => {
  return {
    chunkId: "chunk-1",
    score: 0.91,
    notePath: "notes/source.md",
    noteTitle: "Source",
    heading: "Context",
    snippet: "Source snippet",
    tags: []
  };
};

describe("ChatPaneModel", () => {
  it("A1_state_and_history_contract", async () => {
    const requests: ChatRequest[] = [];
    const model = new ChatPaneModel({
      runChat: (request) => {
        requests.push(request);
        return (async function* () {
          yield { type: "done", finishReason: "stop" } as ChatStreamEvent;
        })();
      },
      runSourceSearch: async () => [],
      openSource: async () => undefined,
      getSettings: () => createSettings(),
      notify: () => undefined
    });

    expect(model.getState()).toEqual({
      draft: "",
      status: "idle",
      turns: [],
      canSend: true,
      canCancel: false
    });

    await model.send("first question");
    const state = model.getState();
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.userMessage).toBe("first question");
    expect(state.turns[0]?.status).toBe("complete");
    expect(requests).toHaveLength(1);
  });

  it("A2_streaming_updates_assistant_turn", async () => {
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          yield { type: "token", text: "Hello" } as ChatStreamEvent;
          yield { type: "token", text: " world" } as ChatStreamEvent;
          yield { type: "done", finishReason: "stop" } as ChatStreamEvent;
        })(),
      runSourceSearch: async () => [],
      openSource: async () => undefined,
      getSettings: () => createSettings(),
      notify: () => undefined
    });

    await model.send("stream this");
    const state = model.getState();
    expect(state.turns[0]?.assistantMessage).toBe("Hello world");
    expect(state.turns[0]?.status).toBe("complete");
  });

  it("A3_maps_and_persists_sources", async () => {
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          yield { type: "done", finishReason: "stop" } as ChatStreamEvent;
        })(),
      runSourceSearch: async () => [createResult()],
      openSource: async () => undefined,
      getSettings: () => createSettings(),
      notify: () => undefined
    });

    await model.send("show sources");
    expect(model.getState().turns[0]?.sources).toEqual([
      {
        chunkId: "chunk-1",
        notePath: "notes/source.md",
        heading: "Context",
        snippet: "Source snippet",
        score: 0.91
      }
    ]);
  });

  it("B1_cancels_active_stream", async () => {
    let resolveGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          yield { type: "token", text: "partial" } as ChatStreamEvent;
          await gate;
          yield { type: "token", text: "ignored" } as ChatStreamEvent;
          yield { type: "done", finishReason: "stop" } as ChatStreamEvent;
        })(),
      runSourceSearch: async () => [],
      openSource: async () => undefined,
      getSettings: () => createSettings(),
      notify: () => undefined
    });

    const streamingStarted = new Promise<void>((resolve) => {
      let unsubscribe: (() => void) | null = null;
      unsubscribe = model.subscribe((state) => {
        if (state.status === "streaming") {
          unsubscribe?.();
          resolve();
        }
      });
    });

    const sendPromise = model.send("cancel me");
    await streamingStarted;
    expect(model.cancelStreaming()).toBe(true);
    resolveGate?.();
    await sendPromise;

    const turn = model.getState().turns[0];
    expect(turn?.assistantMessage).toContain("partial");
    expect(turn?.status).toBe("cancelled");
  });

  it("B2_stream_failures_set_error_state", async () => {
    const notices: string[] = [];
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          throw new Error("provider down");
          yield { type: "done", finishReason: "error" } as ChatStreamEvent;
        })(),
      runSourceSearch: async () => [createResult()],
      openSource: async () => undefined,
      getSettings: () => createSettings(),
      notify: (message) => {
        notices.push(message);
      }
    });

    const didSend = await model.send("fail stream");
    const state = model.getState();
    expect(didSend).toBe(false);
    expect(state.status).toBe("error");
    expect(state.turns[0]?.status).toBe("error");
    expect(state.turns[0]?.errorMessage).toBeTruthy();
    expect(notices).toHaveLength(1);
  });

  it("A1_openSource_delegates_to_deps", async () => {
    const openedSources: Array<{ notePath: string; heading?: string }> = [];
    const model = new ChatPaneModel({
      runChat: () =>
        (async function* () {
          yield { type: "done", finishReason: "stop" } as ChatStreamEvent;
        })(),
      runSourceSearch: async () => [],
      openSource: async (source) => {
        openedSources.push({ notePath: source.notePath, heading: source.heading });
      },
      getSettings: () => createSettings(),
      notify: () => undefined
    });

    await model.openSource({
      chunkId: "chunk-1",
      notePath: "notes/test.md",
      heading: "Section A",
      snippet: "test snippet"
    });

    expect(openedSources).toEqual([{ notePath: "notes/test.md", heading: "Section A" }]);
  });
});
