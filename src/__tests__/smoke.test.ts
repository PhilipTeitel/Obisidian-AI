import { describe, expect, expectTypeOf, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapRuntimeServices } from "../bootstrap/bootstrapRuntimeServices";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "../constants";
import { disposeRuntimeServices } from "../services/ServiceContainer";
import { MVP_PROVIDER_IDS, RUNTIME_SERVICE_CONSTRUCTION_ORDER } from "../types";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  ChunkRecord,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  JobSnapshot,
  ObsidianAISettings,
  RuntimeBootstrapContext,
  RuntimeServiceLifecycle,
  SearchRequest,
  SearchResult
} from "../types";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const sourcePath = (...segments: string[]): string => resolve(CURRENT_DIR, "..", ...segments);
const readSource = (...segments: string[]): string => readFileSync(sourcePath(...segments), "utf8");
const createSettingsSnapshot = (): ObsidianAISettings => {
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

const createRuntimeContext = (): RuntimeBootstrapContext => {
  return {
    app: {} as RuntimeBootstrapContext["app"],
    plugin: {} as RuntimeBootstrapContext["plugin"],
    getSettings: () => createSettingsSnapshot(),
    notify: () => undefined
  };
};

class RecordingService implements RuntimeServiceLifecycle {
  public disposeCount = 0;
  private readonly shouldThrowOnDispose: boolean;

  public constructor(shouldThrowOnDispose = false) {
    this.shouldThrowOnDispose = shouldThrowOnDispose;
  }

  public async init(): Promise<void> {
    return undefined;
  }

  public async dispose(): Promise<void> {
    this.disposeCount += 1;
    if (this.shouldThrowOnDispose) {
      throw new Error("dispose failure");
    }
  }
}

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
    expect(settingsSource.includes("export const snapshotSettings")).toBe(true);
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

  it("bootstraps runtime services in deterministic order", async () => {
    const firstRuntime = await bootstrapRuntimeServices(createRuntimeContext());
    const secondRuntime = await bootstrapRuntimeServices(createRuntimeContext());

    expect(firstRuntime.initializationOrder).toEqual([...RUNTIME_SERVICE_CONSTRUCTION_ORDER]);
    expect(secondRuntime.initializationOrder).toEqual([...RUNTIME_SERVICE_CONSTRUCTION_ORDER]);

    const singleRuntimeServiceSet = new Set([
      firstRuntime.services.providerRegistry,
      firstRuntime.services.embeddingService,
      firstRuntime.services.searchService,
      firstRuntime.services.agentService,
      firstRuntime.services.chatService,
      firstRuntime.services.indexingService
    ]);
    expect(singleRuntimeServiceSet.size).toBe(6);
    expect(firstRuntime.services.providerRegistry).not.toBe(secondRuntime.services.providerRegistry);

    await firstRuntime.services.dispose();
    await secondRuntime.services.dispose();
  });

  it("continues disposal after service-level failures and supports idempotent container dispose", async () => {
    const failingService = new RecordingService(true);
    const succeedingService = new RecordingService(false);

    const failures = await disposeRuntimeServices([
      { name: "indexingService", service: failingService },
      { name: "chatService", service: succeedingService }
    ]);

    expect(failingService.disposeCount).toBe(1);
    expect(succeedingService.disposeCount).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("indexingService");

    const runtime = await bootstrapRuntimeServices(createRuntimeContext());
    await runtime.services.dispose();
    await expect(runtime.services.dispose()).resolves.toBeUndefined();
  });
});
