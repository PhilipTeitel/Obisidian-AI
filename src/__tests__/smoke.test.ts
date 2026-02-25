import { describe, expect, expectTypeOf, it } from "vitest";
import { bootstrapRuntimeServices } from "../bootstrap/bootstrapRuntimeServices";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "../constants";
import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { DEFAULT_SETTINGS, snapshotSettings } from "../settings";
import { disposeRuntimeServices } from "../services/ServiceContainer";
import { MVP_PROVIDER_IDS, RUNTIME_SERVICE_CONSTRUCTION_ORDER } from "../types";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  ChunkContextKind,
  ChunkRecord,
  ChunkerInput,
  ChunkerOptions,
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
    expect(COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE).toBe("obsidian-ai:open-semantic-search-pane");
    expect(COMMAND_IDS.OPEN_CHAT_PANE).toBe("obsidian-ai:open-chat-pane");
  });

  it("exposes expected command display names", () => {
    expect(COMMAND_NAMES.REINDEX_VAULT).toBe("Reindex vault");
    expect(COMMAND_NAMES.INDEX_CHANGES).toBe("Index changes");
    expect(COMMAND_NAMES.SEARCH_SELECTION).toBe("Semantic search selection");
    expect(COMMAND_NAMES.OPEN_SEMANTIC_SEARCH_PANE).toBe("Open semantic search pane");
    expect(COMMAND_NAMES.OPEN_CHAT_PANE).toBe("Open chat pane");
  });

  it("keeps non-secret default settings and snapshot behavior", () => {
    const snapshot = snapshotSettings(DEFAULT_SETTINGS);
    expect(snapshot.embeddingProvider).toBe("openai");
    expect(snapshot.chatProvider).toBe("openai");
    expect(snapshot.indexedFolders).toEqual(["/"]);
    expect(snapshot).not.toBe(DEFAULT_SETTINGS);
    expect(snapshot.indexedFolders).not.toBe(DEFAULT_SETTINGS.indexedFolders);
  });

  it("exports compile-safe domain contracts", async () => {
    const contextKind: ChunkContextKind = "paragraph";
    const chunk: ChunkRecord = {
      id: "chunk-1",
      source: {
        notePath: "notes/example.md",
        noteTitle: "Example",
        headingTrail: ["Top", "Nested"],
        tags: ["ai", "mvp"],
        contextKind
      },
      content: "Chunk body",
      hash: "abc123",
      updatedAt: Date.now()
    };

    const chunkerInput: ChunkerInput = {
      notePath: chunk.source.notePath,
      noteTitle: chunk.source.noteTitle,
      markdown: chunk.content,
      updatedAt: chunk.updatedAt
    };
    const chunkerOptions: ChunkerOptions = {
      maxChunkChars: 500
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
      snippet: "Example snippet",
      tags: ["ai", "mvp"]
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
    expectTypeOf(chunkerInput.notePath).toEqualTypeOf<string>();
    expectTypeOf(chunkerOptions.maxChunkChars).toEqualTypeOf<number | undefined>();
    expect(streamEvents).toHaveLength(2);
    expect(await embeddingProvider.embed(embeddingRequest)).toEqual(embeddingResponse);
  });

  it("normalizes representative provider, network, storage, and runtime errors", () => {
    const providerError = normalizeRuntimeError(new Error("OpenAI provider returned 401 unauthorized"));
    expect(providerError.domain).toBe("provider");
    expect(providerError.code).toBe("PROVIDER_AUTH_FAILURE");
    expect(providerError.userMessage.length).toBeGreaterThan(0);

    const networkError = normalizeRuntimeError(new Error("fetch failed: ETIMEDOUT"));
    expect(networkError.domain).toBe("network");
    expect(networkError.retryable).toBe(true);

    const storageError = normalizeRuntimeError(new Error("sqlite disk I/O error"));
    expect(storageError.domain).toBe("storage");
    expect(storageError.code).toBe("STORAGE_IO_FAILURE");

    const runtimeError = normalizeRuntimeError(new Error("Unexpected runtime invariant"));
    expect(runtimeError.domain).toBe("runtime");
    expect(runtimeError.code).toBe("RUNTIME_FAILURE");
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
    expect(firstRuntime.services.providerRegistry.listChatProviders().map((provider) => provider.id)).toEqual([
      "ollama",
      "openai"
    ]);

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
    expect(failures[0].name).toBe("indexingService");
    expect(failures[0].error.code).toBe("RUNTIME_FAILURE");

    const runtime = await bootstrapRuntimeServices(createRuntimeContext());
    await runtime.services.dispose();
    await expect(runtime.services.dispose()).resolves.toBeUndefined();
  });
});
