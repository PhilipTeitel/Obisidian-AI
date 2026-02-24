import type {
  AgentServiceContract,
  ChatContextChunk,
  ChatRequest,
  ChatServiceContract,
  ChatStreamEvent,
  ProviderRegistryContract,
  SearchResult,
  SearchServiceContract
} from "../types";
import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";

export interface ChatServiceDeps {
  searchService: SearchServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
}

const CHAT_RETRIEVAL_TOP_K = 5;

const getLatestUserMessage = (request: ChatRequest): string => {
  for (const message of [...request.messages].reverse()) {
    if (message.role === "user") {
      return message.content.trim();
    }
  }
  return "";
};

const mapSearchResultsToContext = (results: SearchResult[]): ChatContextChunk[] => {
  return results.map((result) => ({
    chunkId: result.chunkId,
    notePath: result.notePath,
    heading: result.heading,
    snippet: result.snippet,
    score: result.score
  }));
};

export class ChatService implements ChatServiceContract {
  private disposed = false;
  private readonly deps: ChatServiceDeps;

  public constructor(deps: ChatServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async *chat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    if (this.disposed) {
      throw new Error("ChatService is disposed.");
    }

    try {
      const retrievalQuery = getLatestUserMessage(request);
      const searchResults =
        retrievalQuery.length === 0
          ? []
          : await this.deps.searchService.search({
              query: retrievalQuery,
              topK: CHAT_RETRIEVAL_TOP_K
            });
      const providerRequest: ChatRequest = {
        ...request,
        context: mapSearchResultsToContext(searchResults)
      };

      const provider = this.deps.providerRegistry.getChatProvider(request.providerId);
      for await (const event of provider.complete(providerRequest)) {
        yield event;
      }
    } catch (error: unknown) {
      throw normalizeRuntimeError(error, {
        operation: "ChatService.chat",
        providerId: request.providerId,
        messageCount: request.messages.length
      });
    }
  }
}
