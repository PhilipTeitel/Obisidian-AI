import type {
  AgentServiceContract,
  ChatRequest,
  ChatServiceContract,
  ChatStreamEvent,
  ProviderRegistryContract,
  SearchServiceContract
} from "../types";

export interface ChatServiceDeps {
  searchService: SearchServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
}

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

    await this.deps.searchService.search({
      query: request.messages[request.messages.length - 1]?.content ?? "",
      topK: Math.max(1, request.context.length || 5)
    });

    yield {
      type: "error",
      message: `Chat is not implemented yet for provider: ${this.deps.providerRegistry.getChatProviderId()}`,
      retryable: false
    };
    yield {
      type: "done",
      finishReason: "error"
    };
  }
}
