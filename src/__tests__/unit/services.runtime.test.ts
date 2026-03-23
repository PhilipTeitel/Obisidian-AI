import { describe, expect, it } from "vitest";
import { AgentService } from "../../services/AgentService";
import { ChatService } from "../../services/ChatService";
import { EmbeddingService } from "../../services/EmbeddingService";
import { IndexingService } from "../../services/IndexingService";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import { ProviderRegistry } from "../../providers/ProviderRegistry";
import { SearchService } from "../../services/SearchService";
import type {
  ChatRequest,
  ChatStreamEvent,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  ObsidianAISettings,
  RuntimeBootstrapContext
} from "../../types";

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
    logLevel: "info",
    summaryMaxTokens: 100,
    matchedContentBudget: 2000,
    siblingContextBudget: 1000,
    parentSummaryBudget: 1000
  };
};

const createEmbeddingResponse = (request: EmbeddingRequest): EmbeddingResponse => {
  return {
    providerId: request.providerId,
    model: request.model,
    vectors: request.inputs.map(() => ({
      values: [0.1, 0.2],
      dimensions: 2
    }))
  };
};

const createVectorStoreRepository = () => {
  return {
    getSchemaMetadata: async () => ({
      schemaVersion: 1,
      appliedMigrationIds: [],
      paths: {
        rootDir: ".obsidian/plugins/obsidian-ai-mvp/storage",
        sqliteDbPath: ".obsidian/plugins/obsidian-ai-mvp/storage/vector-store.sqlite3",
        migrationsDir: ".obsidian/plugins/obsidian-ai-mvp/storage/migrations"
      }
    }),
    replaceAllFromChunks: async () => undefined,
    upsertFromChunks: async () => undefined,
    deleteByNotePaths: async () => undefined,
    queryNearestNeighbors: async () => []
  };
};

const collectEvents = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const createMemoryPlugin = (): RuntimeBootstrapContext["plugin"] => {
  let data: unknown = null;
  return {
    loadData: async () => data,
    saveData: async (nextData: unknown) => {
      data = nextData;
    }
  } as unknown as RuntimeBootstrapContext["plugin"];
};

describe("runtime service unit behavior", () => {
  it("ProviderRegistry reads active providers from settings and tracks disposal state", async () => {
    const settings = createSettings();
    const registry = new ProviderRegistry({
      app: {} as RuntimeBootstrapContext["app"],
      plugin: {} as RuntimeBootstrapContext["plugin"],
      getSettings: () => settings,
      notify: () => undefined
    });

    await registry.init();
    expect(registry.getEmbeddingProviderId()).toBe("openai");
    expect(registry.getChatProviderId()).toBe("openai");

    const provider: EmbeddingProvider = {
      id: "openai",
      name: "OpenAI",
      embed: async (request: EmbeddingRequest) => createEmbeddingResponse(request)
    };
    registry.registerEmbeddingProvider(provider);
    expect(registry.getEmbeddingProvider("openai").name).toBe("OpenAI");
    expect(registry.listEmbeddingProviders()).toHaveLength(1);

    settings.embeddingProvider = "ollama";
    settings.chatProvider = "ollama";
    expect(registry.getEmbeddingProviderId()).toBe("ollama");
    expect(registry.getChatProviderId()).toBe("ollama");

    await registry.dispose();
    expect(registry.isDisposed()).toBe(true);
  });

  it("IndexingService runs reindex/incremental paths and enforces disposed guard", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const embeddingRequests: EmbeddingRequest[] = [];
    const provider: EmbeddingProvider = {
      id: "openai",
      name: "OpenAI",
      embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => createEmbeddingResponse(request)
    };
    const embeddingService = new EmbeddingService({
      providerRegistry: {
        init: async () => undefined,
        dispose: async () => undefined,
        getEmbeddingProviderId: () => "openai",
        getChatProviderId: () => "openai",
        registerEmbeddingProvider: () => undefined,
        getEmbeddingProvider: () => provider,
        listEmbeddingProviders: () => [provider],
        registerChatProvider: () => undefined,
        getChatProvider: () => {
          throw new Error("Not needed for indexing test.");
        },
        listChatProviders: () => []
      },
      getSettings: () => settings
    });

    const embed = embeddingService.embed.bind(embeddingService);
    const spyingEmbeddingService = {
      init: async () => undefined,
      dispose: async () => undefined,
      embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
        embeddingRequests.push(request);
        return embed(request);
      }
    };

    const service = new IndexingService({
      app: {
        vault: {
          getMarkdownFiles: () => [
            {
              path: "notes/example.md",
              basename: "example",
              stat: {
                mtime: 1
              }
            }
          ],
          cachedRead: async () => "# Example\n\nBody text"
        }
      } as unknown as RuntimeBootstrapContext["app"],
      embeddingService: spyingEmbeddingService,
      vectorStoreRepository: createVectorStoreRepository(),
      getSettings: () => settings,
      manifestStore: new IndexManifestStore({
        plugin
      }),
      jobStateStore: new IndexJobStateStore({
        plugin
      }),
      summaryService: {
        init: async () => undefined,
        dispose: async () => undefined,
        generateSummaries: async () => [],
        regenerateFromNode: async () => [],
        detectStaleSummaries: async () => [],
        propagateSummariesForChangedNodes: async () => []
      },
      hierarchicalStore: {
        upsertNodeTree: async () => undefined,
        deleteByNotePath: async () => undefined,
        getNode: async () => null,
        getChildren: async () => [],
        getAncestorChain: async () => [],
        getSiblings: async () => [],
        getNodesByNotePath: async () => [],
        searchSummaryEmbeddings: async () => [],
        searchContentEmbeddings: async () => [],
        upsertSummary: async () => undefined,
        getSummary: async () => null,
        upsertEmbedding: async () => undefined,
        upsertTags: async () => undefined,
        upsertCrossReferences: async () => undefined,
        getCrossReferences: async () => []
      }
    });

    await service.init();
    const reindexSnapshot = await service.reindexVault();
    const incrementalSnapshot = await service.indexChanges();

    expect(reindexSnapshot.type).toBe("reindex-vault");
    expect(incrementalSnapshot.type).toBe("index-changes");
    expect(embeddingRequests.length).toBeGreaterThanOrEqual(1);
    expect(embeddingRequests[0]?.providerId).toBe("openai");
    expect(embeddingRequests[0]?.model).toBe("text-embedding-3-small");
    expect((embeddingRequests[0]?.inputs.length ?? 0) > 0).toBe(true);

    await service.dispose();
    await expect(service.reindexVault()).rejects.toThrow("IndexingService is disposed.");
  });

  it("SearchService embeds query text for search and selection paths", async () => {
    const settings = createSettings();
    const embeddingRequests: EmbeddingRequest[] = [];
    const searchQueries: string[] = [];
    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: {
        ...createVectorStoreRepository(),
        queryNearestNeighbors: async ({ topK }) => {
          searchQueries.push(`topK:${topK}`);
          return [];
        }
      },
      getSettings: () => settings
    });

    await service.init();
    await service.search({ query: "semantic query", topK: 5 });
    await service.searchSelection("selected paragraph");
    await service.searchSelection("   ");

    expect(embeddingRequests).toHaveLength(2);
    expect(embeddingRequests[0].inputs).toEqual(["semantic query"]);
    expect(embeddingRequests[1].inputs).toEqual(["selected paragraph"]);
    expect(searchQueries).toEqual(["topK:5", "topK:5"]);

    await service.dispose();
    await expect(service.search({ query: "after-dispose", topK: 1 })).rejects.toThrow("SearchService is disposed.");
  });

  it("AgentService enforces max generated note size and emits notify messages", async () => {
    const settings = createSettings();
    settings.maxGeneratedNoteSize = 5;
    settings.agentOutputFolders = ["notes"];
    const notifications: string[] = [];
    const modifiedFiles: string[] = [];
    const service = new AgentService({
      app: {
        vault: {
          create: async () => undefined,
          modify: async (file: { path: string }) => {
            modifiedFiles.push(file.path);
          },
          getAbstractFileByPath: (path: string) => {
            return path === "notes/allowed.md" ? { path } : null;
          }
        }
      } as RuntimeBootstrapContext["app"],
      getSettings: () => settings,
      notify: (message: string) => {
        notifications.push(message);
      }
    });

    await service.init();
    await service.createNote("notes/blocked.md", "123456");
    await service.updateNote("notes/allowed.md", "1234");

    expect(notifications[0]).toContain("Create note blocked");
    expect(notifications[1]).toContain("Updated note: notes/allowed.md");
    expect(modifiedFiles).toEqual(["notes/allowed.md"]);

    await service.dispose();
    await expect(service.createNote("notes/fail.md", "a")).rejects.toThrow("AgentService is disposed.");
  });

  it("ChatService delegates to registered chat providers and preserves stream events", async () => {
    const searchQueries: string[] = [];
    const providerContexts: ChatRequest["context"][] = [];
    const service = new ChatService({
      searchService: {
        init: async () => undefined,
        dispose: async () => undefined,
        search: async ({ query }) => {
          searchQueries.push(query);
          return [
            {
              chunkId: "chunk-1",
              score: 0.88,
              notePath: "notes/runtime.md",
              noteTitle: "runtime",
              heading: "Summary",
              snippet: "Indexed context",
              tags: []
            }
          ];
        },
        searchSelection: async () => []
      },
      agentService: {
        init: async () => undefined,
        dispose: async () => undefined,
        createNote: async () => undefined,
        updateNote: async () => undefined
      },
      providerRegistry: {
        init: async () => undefined,
        dispose: async () => undefined,
        getEmbeddingProviderId: () => "openai",
        getChatProviderId: () => "ollama",
        registerEmbeddingProvider: () => undefined,
        getEmbeddingProvider: () => {
          throw new Error("Not needed for chat test.");
        },
        listEmbeddingProviders: () => [],
        registerChatProvider: () => undefined,
        getChatProvider: () => ({
          id: "ollama",
          name: "Ollama",
          async *complete(nextRequest: ChatRequest): AsyncIterable<ChatStreamEvent> {
            providerContexts.push(nextRequest.context);
            yield { type: "token", text: "hello" };
            yield { type: "done", finishReason: "stop" };
          }
        }),
        listChatProviders: () => []
      }
    });

    const request: ChatRequest = {
      providerId: "ollama",
      model: "llama3.1",
      messages: [{ role: "user", content: "Summarize this note." }],
      context: [],
      timeoutMs: 30000
    };

    await service.init();
    const events = await collectEvents(service.chat(request));

    expect(searchQueries).toEqual(["Summarize this note."]);
    expect(providerContexts).toEqual([
      [
        {
          chunkId: "chunk-1",
          notePath: "notes/runtime.md",
          heading: "Summary",
          snippet: "Indexed context",
          score: 0.88
        }
      ]
    ]);
    expect(events[0]).toEqual({
      type: "token",
      text: "hello"
    });
    expect(events[1]).toEqual({
      type: "done",
      finishReason: "stop"
    });

    await service.dispose();
    await expect(collectEvents(service.chat(request))).rejects.toThrow("ChatService is disposed.");
  });
});
