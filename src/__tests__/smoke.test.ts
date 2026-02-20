import { describe, expect, expectTypeOf, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "../constants";
import { MVP_PROVIDER_IDS } from "../types";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  ChunkRecord,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  JobSnapshot,
  SearchRequest,
  SearchResult
} from "../types";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const sourcePath = (...segments: string[]): string => resolve(CURRENT_DIR, "..", ...segments);
const readSource = (...segments: string[]): string => readFileSync(sourcePath(...segments), "utf8");

describe("plugin shell smoke test", () => {
  it("exposes stable runtime IDs", () => {
    expect(SEARCH_VIEW_TYPE).toBe("obsidian-ai:search-view");
    expect(CHAT_VIEW_TYPE).toBe("obsidian-ai:chat-view");
    expect(COMMAND_IDS.REINDEX_VAULT).toBe("obsidian-ai:reindex-vault");
    expect(COMMAND_IDS.INDEX_CHANGES).toBe("obsidian-ai:index-changes");
    expect(COMMAND_IDS.SEARCH_SELECTION).toBe("obsidian-ai:search-selection");
  });

  it("exposes expected command display names", () => {
    expect(COMMAND_NAMES.REINDEX_VAULT).toBe("Reindex vault");
    expect(COMMAND_NAMES.INDEX_CHANGES).toBe("Index changes");
    expect(COMMAND_NAMES.SEARCH_SELECTION).toBe("Semantic search selection");
  });

  it("registers lifecycle shell surfaces in source", () => {
    const mainSource = readSource("main.ts");
    expect(mainSource.includes("public async onload(): Promise<void>")).toBe(true);
    expect(mainSource.includes("public async onunload(): Promise<void>")).toBe(true);
    expect(mainSource.includes("this.registerView(SEARCH_VIEW_TYPE")).toBe(true);
    expect(mainSource.includes("this.registerView(CHAT_VIEW_TYPE")).toBe(true);
    expect(mainSource.includes("this.addSettingTab(new ObsidianAISettingTab")).toBe(true);
  });

  it("keeps view shell contract methods in source", () => {
    const searchViewSource = readSource("ui", "SearchView.ts");
    const chatViewSource = readSource("ui", "ChatView.ts");
    expect(searchViewSource.includes("public getViewType(): string")).toBe(true);
    expect(searchViewSource.includes("public async onOpen(): Promise<void>")).toBe(true);
    expect(searchViewSource.includes("public async onClose(): Promise<void>")).toBe(true);
    expect(chatViewSource.includes("public getViewType(): string")).toBe(true);
    expect(chatViewSource.includes("public async onOpen(): Promise<void>")).toBe(true);
    expect(chatViewSource.includes("public async onClose(): Promise<void>")).toBe(true);
  });

  it("keeps non-secret defaults in settings source", () => {
    const settingsSource = readSource("settings.ts");
    expect(settingsSource.includes("export const DEFAULT_SETTINGS")).toBe(true);
    expect(settingsSource.includes("embeddingProvider: \"openai\"")).toBe(true);
    expect(settingsSource.includes("chatProvider: \"openai\"")).toBe(true);
    expect(settingsSource.includes("indexedFolders: [\"/\"]")).toBe(true);
    expect(settingsSource.includes("openai-api-key")).toBe(false);
  });

  it("exports compile-safe domain contracts", async () => {
    const chunk: ChunkRecord = {
      id: "chunk-1",
      source: {
        notePath: "notes/example.md",
        noteTitle: "Example",
        headingTrail: ["Top", "Nested"],
        tags: ["ai", "mvp"]
      },
      content: "Chunk body",
      hash: "abc123",
      updatedAt: Date.now()
    };

    const embeddingRequest: EmbeddingRequest = {
      providerId: "openai",
      model: "text-embedding-3-small",
      inputs: [chunk.content]
    };

    const embeddingResponse: EmbeddingResponse = {
      providerId: embeddingRequest.providerId,
      model: embeddingRequest.model,
      vectors: [{ values: [0.1, 0.2], dimensions: 2 }]
    };

    const embeddingProvider: EmbeddingProvider = {
      id: "openai",
      name: "OpenAI",
      embed: async () => embeddingResponse
    };

    const searchRequest: SearchRequest = {
      query: "semantic query",
      topK: 5
    };

    const searchResult: SearchResult = {
      chunkId: chunk.id,
      score: 0.9,
      notePath: chunk.source.notePath,
      noteTitle: chunk.source.noteTitle,
      heading: chunk.source.headingTrail[1],
      snippet: "Example snippet"
    };

    const chatRequest: ChatRequest = {
      providerId: "ollama",
      model: "llama3.1",
      messages: [{ role: "user", content: "Summarize context." }],
      context: [
        {
          chunkId: searchResult.chunkId,
          notePath: searchResult.notePath,
          heading: searchResult.heading,
          snippet: searchResult.snippet,
          score: searchResult.score
        }
      ],
      timeoutMs: 30000
    };

    const tokenEvent: ChatStreamEvent = { type: "token", text: "Hello" };
    const doneEvent: ChatStreamEvent = { type: "done", finishReason: "stop" };
    const chatProvider: ChatProvider = {
      id: "ollama",
      name: "Ollama",
      async *complete(): AsyncIterable<ChatStreamEvent> {
        yield tokenEvent;
        yield doneEvent;
      }
    };

    const streamEvents: ChatStreamEvent[] = [];
    for await (const event of chatProvider.complete(chatRequest)) {
      streamEvents.push(event);
    }

    const snapshot: JobSnapshot = {
      id: "job-1",
      type: "index-changes",
      status: "running",
      startedAt: Date.now(),
      progress: {
        completed: 1,
        total: 2,
        label: "Indexing",
        detail: "Reading notes"
      }
    };

    expectTypeOf(MVP_PROVIDER_IDS).toEqualTypeOf<readonly ["openai", "ollama"]>();
    expectTypeOf(searchRequest.topK).toEqualTypeOf<number>();
    expectTypeOf(snapshot.progress.label).toEqualTypeOf<string>();
    expect(streamEvents).toHaveLength(2);
    expect(await embeddingProvider.embed(embeddingRequest)).toEqual(embeddingResponse);
  });
});
