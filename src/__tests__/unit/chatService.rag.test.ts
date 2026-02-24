import { describe, expect, it } from "vitest";
import { ChatService } from "../../services/ChatService";
import type { ChatRequest, ChatStreamEvent, EmbeddingProvider, EmbeddingRequest, EmbeddingResponse, SearchResult } from "../../types";

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

const collectEvents = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

interface HarnessOptions {
  searchResults?: SearchResult[];
  searchError?: Error;
  providerError?: Error;
}

const createHarness = (options: HarnessOptions = {}) => {
  const searchCalls: Array<{ query: string; topK: number; minScore?: number }> = [];
  let providerRequest: ChatRequest | null = null;
  const embeddingProvider = createEmbeddingProvider();

  const service = new ChatService({
    searchService: {
      init: async () => undefined,
      dispose: async () => undefined,
      search: async (request) => {
        searchCalls.push(request);
        if (options.searchError) {
          throw options.searchError;
        }
        return options.searchResults ?? [];
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
      getChatProviderId: () => "openai",
      registerEmbeddingProvider: () => undefined,
      getEmbeddingProvider: () => embeddingProvider,
      listEmbeddingProviders: () => [embeddingProvider],
      registerChatProvider: () => undefined,
      getChatProvider: () => ({
        id: "openai",
        name: "OpenAI Chat",
        async *complete(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
          providerRequest = request;
          if (options.providerError) {
            throw options.providerError;
          }
          yield { type: "done", finishReason: "stop" };
        }
      }),
      listChatProviders: () => []
    }
  });

  return {
    service,
    getSearchCalls: () => [...searchCalls],
    getProviderRequest: () => providerRequest
  };
};

const createRequest = (messages: ChatRequest["messages"]): ChatRequest => {
  return {
    providerId: "openai",
    model: "gpt-4o-mini",
    messages,
    context: [
      {
        chunkId: "external-context",
        notePath: "external/source.md",
        heading: "External",
        snippet: "Should not be forwarded",
        score: 0.1
      }
    ],
    timeoutMs: 30000
  };
};

describe("ChatService retrieval-augmented orchestration", () => {
  it("A1_uses_latest_user_message_for_retrieval", async () => {
    const harness = createHarness();
    await harness.service.init();

    const request = createRequest([
      { role: "system", content: "You are concise." },
      { role: "user", content: "first prompt" },
      { role: "assistant", content: "intermediate answer" },
      { role: "user", content: "latest prompt  " }
    ]);

    await collectEvents(harness.service.chat(request));
    expect(harness.getSearchCalls()).toEqual([{ query: "latest prompt", topK: 5 }]);

    const noUserHarness = createHarness();
    await noUserHarness.service.init();
    const noUserRequest = createRequest([{ role: "assistant", content: "No user message." }]);
    await collectEvents(noUserHarness.service.chat(noUserRequest));
    expect(noUserHarness.getSearchCalls()).toHaveLength(0);
  });

  it("A2_maps_search_results_to_provider_context", async () => {
    const harness = createHarness({
      searchResults: [
        {
          chunkId: "chunk-1",
          score: 0.92,
          notePath: "notes/alpha.md",
          noteTitle: "Alpha",
          heading: "Summary",
          snippet: "Indexed snippet",
          tags: ["tag-a"]
        }
      ]
    });
    await harness.service.init();

    await collectEvents(harness.service.chat(createRequest([{ role: "user", content: "retrieve context" }])));
    expect(harness.getProviderRequest()?.context).toEqual([
      {
        chunkId: "chunk-1",
        notePath: "notes/alpha.md",
        heading: "Summary",
        snippet: "Indexed snippet",
        score: 0.92
      }
    ]);
  });

  it("A3_retrieval_uses_default_topk", async () => {
    const harness = createHarness();
    await harness.service.init();

    await collectEvents(harness.service.chat(createRequest([{ role: "user", content: "what changed?" }])));
    expect(harness.getSearchCalls()[0]?.topK).toBe(5);
  });

  it("B1_normalizes_retrieval_or_provider_errors", async () => {
    const searchFailureHarness = createHarness({
      searchError: new Error("search failed")
    });
    await searchFailureHarness.service.init();
    await expect(
      collectEvents(searchFailureHarness.service.chat(createRequest([{ role: "user", content: "query" }])))
    ).rejects.toMatchObject({
      message: "search failed",
      context: expect.objectContaining({ operation: "ChatService.chat" })
    });

    const providerFailureHarness = createHarness({
      providerError: new Error("provider failed")
    });
    await providerFailureHarness.service.init();
    await expect(
      collectEvents(providerFailureHarness.service.chat(createRequest([{ role: "user", content: "query" }])))
    ).rejects.toMatchObject({
      message: "provider failed",
      context: expect.objectContaining({ operation: "ChatService.chat" })
    });
  });

  it("B2_disposed_guard", async () => {
    const harness = createHarness();
    await harness.service.init();
    await harness.service.dispose();

    await expect(collectEvents(harness.service.chat(createRequest([{ role: "user", content: "after dispose" }])))).rejects.toThrow(
      "ChatService is disposed."
    );
  });
});
