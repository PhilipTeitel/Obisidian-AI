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

    const provider = this.deps.providerRegistry.getChatProvider(request.providerId);
    for await (const event of provider.complete(request)) {
      yield event;
    }
  }
}
