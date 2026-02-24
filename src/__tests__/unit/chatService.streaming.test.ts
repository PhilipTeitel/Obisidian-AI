import { describe, expect, it } from "vitest";
import { ChatService } from "../../services/ChatService";
import type { ChatServiceDeps } from "../../services/ChatService";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse
} from "../../types";

const createEmbeddingProvider = (): EmbeddingProvider => {
  return {
    id: "openai",
    name: "OpenAI Embeddings",
    embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => ({
      providerId: request.providerId,
      model: request.model,
      vectors: []
    })
  };
};

const createChatProvider = (id: "openai" | "ollama", events: ChatStreamEvent[]): ChatProvider => {
  return {
    id,
    name: `${id} chat`,
    async *complete(): AsyncIterable<ChatStreamEvent> {
      for (const event of events) {
        yield event;
      }
    }
  };
};

const createRequest = (providerId: "openai" | "ollama" | "missing-provider"): ChatRequest => {
  return {
    providerId,
    model: "chat-model",
    messages: [{ role: "user", content: "Summarize this note." }],
    context: [],
    timeoutMs: 30000
  };
};

const collectEvents = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const createDeps = (providers: ChatProvider[]): ChatServiceDeps => {
  const chatProviders = new Map(providers.map((provider) => [provider.id, provider]));
  const embeddingProvider = createEmbeddingProvider();
  return {
    searchService: {
      init: async () => undefined,
      dispose: async () => undefined,
      search: async () => [],
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
      getChatProviderId: () => "openai",
      registerEmbeddingProvider: () => undefined,
      getEmbeddingProvider: () => embeddingProvider,
      listEmbeddingProviders: () => [embeddingProvider],
      registerChatProvider: () => undefined,
      getChatProvider: (providerId = "openai") => {
        const provider = chatProviders.get(providerId);
        if (!provider) {
          throw new Error(`Chat provider is not registered: ${providerId}`);
        }
        return provider;
      },
      listChatProviders: () => [...chatProviders.values()]
    }
  };
};

describe("ChatService streaming delegation", () => {
  it("B1_forwards_provider_stream_events", async () => {
    const openAIProvider = createChatProvider("openai", [
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
      { type: "done", finishReason: "stop" }
    ]);
    const service = new ChatService(createDeps([openAIProvider]));
    await service.init();

    const events = await collectEvents(service.chat(createRequest("openai")));
    expect(events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
      { type: "done", finishReason: "stop" }
    ]);
  });

  it("B2_provider_selection_and_missing_provider", async () => {
    const openAIProvider = createChatProvider("openai", [{ type: "done", finishReason: "stop" }]);
    const ollamaProvider = createChatProvider("ollama", [{ type: "done", finishReason: "length" }]);
    const service = new ChatService(createDeps([openAIProvider, ollamaProvider]));
    await service.init();

    const ollamaEvents = await collectEvents(service.chat(createRequest("ollama")));
    expect(ollamaEvents).toEqual([{ type: "done", finishReason: "length" }]);

    await expect(collectEvents(service.chat(createRequest("missing-provider")))).rejects.toThrow(
      "Chat provider is not registered: missing-provider"
    );
  });

  it("B3_disposed_guard", async () => {
    const service = new ChatService(createDeps([createChatProvider("openai", [{ type: "done", finishReason: "stop" }])]));
    await service.init();
    await service.dispose();

    await expect(collectEvents(service.chat(createRequest("openai")))).rejects.toThrow("ChatService is disposed.");
  });
});
