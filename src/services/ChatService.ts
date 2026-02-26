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
import { createRuntimeLogger } from "../logging/runtimeLogger";

export interface ChatServiceDeps {
  searchService: SearchServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
}

const CHAT_RETRIEVAL_TOP_K = 5;
const logger = createRuntimeLogger("ChatService");

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
    const operationLogger = logger.withOperation();
    const chatStartedAt = Date.now();
    operationLogger.info({
      event: "chat.turn.start",
      message: "Chat turn started.",
      context: {
        providerId: request.providerId,
        messageCount: request.messages.length
      }
    });

    try {
      const retrievalQuery = getLatestUserMessage(request);
      const retrievalStartedAt = Date.now();
      const searchResults =
        retrievalQuery.length === 0
          ? []
          : await this.deps.searchService.search({
              query: retrievalQuery,
              topK: CHAT_RETRIEVAL_TOP_K
            });
      operationLogger.info({
        event: "chat.turn.retrieval.completed",
        message: "Chat retrieval phase completed.",
        context: {
          queryLength: retrievalQuery.length,
          resultCount: searchResults.length,
          elapsedMs: Date.now() - retrievalStartedAt
        }
      });
      const providerRequest: ChatRequest = {
        ...request,
        context: mapSearchResultsToContext(searchResults)
      };

      const providerStartedAt = Date.now();
      const provider = this.deps.providerRegistry.getChatProvider(request.providerId);
      operationLogger.info({
        event: "chat.turn.provider.start",
        message: "Chat provider stream started.",
        context: {
          providerId: request.providerId,
          contextChunkCount: providerRequest.context.length
        }
      });
      let streamEventCount = 0;
      let tokenEventCount = 0;
      for await (const event of provider.complete(providerRequest)) {
        streamEventCount += 1;
        if (event.type === "token") {
          tokenEventCount += 1;
        }
        if (event.type === "error") {
          operationLogger.warn({
            event: "chat.turn.provider.stream_error_event",
            message: "Chat provider emitted an error stream event.",
            context: {
              retryable: event.retryable
            }
          });
        }
        if (event.type === "done") {
          operationLogger.info({
            event: "chat.turn.provider.done_event",
            message: "Chat provider emitted a done stream event.",
            context: {
              finishReason: event.finishReason
            }
          });
        }
        yield event;
      }
      operationLogger.info({
        event: "chat.turn.completed",
        message: "Chat turn completed.",
        context: {
          streamEventCount,
          tokenEventCount,
          providerElapsedMs: Date.now() - providerStartedAt,
          elapsedMs: Date.now() - chatStartedAt
        }
      });
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "ChatService.chat",
        providerId: request.providerId,
        messageCount: request.messages.length
      });
      operationLogger.error({
        event: "chat.turn.failed",
        message: "Chat turn failed.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      throw normalized;
    }
  }
}
