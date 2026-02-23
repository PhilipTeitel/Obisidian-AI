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
    chatTimeout: 30000
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
    const embeddingService = new EmbeddingService({
      providerRegistry: {
        init: async () => undefined,
        dispose: async () => undefined,
        getEmbeddingProviderId: () => "openai",
        getChatProviderId: () => "openai"
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
      getSettings: () => settings,
      manifestStore: new IndexManifestStore({
        plugin
      }),
      jobStateStore: new IndexJobStateStore({
        plugin
      })
    });

    await service.init();
    const reindexSnapshot = await service.reindexVault();
    const incrementalSnapshot = await service.indexChanges();

    expect(reindexSnapshot.type).toBe("reindex-vault");
    expect(incrementalSnapshot.type).toBe("index-changes");
    expect(embeddingRequests).toHaveLength(1);
    expect(embeddingRequests[0]?.providerId).toBe("openai");
    expect(embeddingRequests[0]?.model).toBe("text-embedding-3-small");
    expect((embeddingRequests[0]?.inputs.length ?? 0) > 0).toBe(true);

    await service.dispose();
    await expect(service.reindexVault()).rejects.toThrow("IndexingService is disposed.");
  });

  it("SearchService embeds query text for search and selection paths", async () => {
    const settings = createSettings();
    const embeddingRequests: EmbeddingRequest[] = [];
    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      getSettings: () => settings
    });

    await service.init();
    await service.search({ query: "semantic query", topK: 5 });
    await service.searchSelection("selected paragraph");

    expect(embeddingRequests).toHaveLength(2);
    expect(embeddingRequests[0].inputs).toEqual(["semantic query"]);
    expect(embeddingRequests[1].inputs).toEqual(["selected paragraph"]);

    await service.dispose();
    await expect(service.search({ query: "after-dispose", topK: 1 })).rejects.toThrow("SearchService is disposed.");
  });

  it("AgentService enforces max generated note size and emits notify messages", async () => {
    const settings = createSettings();
    settings.maxGeneratedNoteSize = 5;
    const notifications: string[] = [];
    const service = new AgentService({
      getSettings: () => settings,
      notify: (message: string) => {
        notifications.push(message);
      }
    });

    await service.init();
    await service.createNote("notes/blocked.md", "123456");
    await service.updateNote("notes/allowed.md", "1234");

    expect(notifications[0]).toContain("Create note blocked");
    expect(notifications[1]).toContain("Update note is not implemented yet for path: notes/allowed.md");

    await service.dispose();
    await expect(service.createNote("notes/fail.md", "a")).rejects.toThrow("AgentService is disposed.");
  });

  it("ChatService searches context and emits error + done stream events", async () => {
    const searchQueries: string[] = [];
    const service = new ChatService({
      searchService: {
        init: async () => undefined,
        dispose: async () => undefined,
        search: async ({ query }) => {
          searchQueries.push(query);
          return [];
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
        getChatProviderId: () => "ollama"
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
    expect(events[0]).toEqual({
      type: "error",
      message: "Chat is not implemented yet for provider: ollama",
      retryable: false
    });
    expect(events[1]).toEqual({
      type: "done",
      finishReason: "error"
    });

    await service.dispose();
    await expect(collectEvents(service.chat(request))).rejects.toThrow("ChatService is disposed.");
  });
});
