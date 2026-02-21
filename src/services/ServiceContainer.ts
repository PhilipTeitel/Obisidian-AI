import type {
  AgentServiceContract,
  ChatServiceContract,
  EmbeddingServiceContract,
  IndexingServiceContract,
  ProviderRegistryContract,
  RuntimeServiceLifecycle,
  RuntimeServiceName,
  RuntimeServices,
  SearchServiceContract
} from "../types";

export interface NamedRuntimeService {
  name: RuntimeServiceName;
  service: RuntimeServiceLifecycle;
}

export interface ServiceContainerDeps {
  indexingService: IndexingServiceContract;
  embeddingService: EmbeddingServiceContract;
  searchService: SearchServiceContract;
  chatService: ChatServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
  disposeOrder: RuntimeServiceName[];
}

export const disposeRuntimeServices = async (entries: NamedRuntimeService[]): Promise<string[]> => {
  const failures: string[] = [];
  for (const entry of entries) {
    try {
      await entry.service.dispose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${entry.name}: ${message}`);
    }
  }
  return failures;
};

export class ServiceContainer implements RuntimeServices {
  public readonly indexingService: IndexingServiceContract;
  public readonly embeddingService: EmbeddingServiceContract;
  public readonly searchService: SearchServiceContract;
  public readonly chatService: ChatServiceContract;
  public readonly agentService: AgentServiceContract;
  public readonly providerRegistry: ProviderRegistryContract;

  private readonly disposeOrder: RuntimeServiceName[];
  private disposed = false;

  public constructor(deps: ServiceContainerDeps) {
    this.indexingService = deps.indexingService;
    this.embeddingService = deps.embeddingService;
    this.searchService = deps.searchService;
    this.chatService = deps.chatService;
    this.agentService = deps.agentService;
    this.providerRegistry = deps.providerRegistry;
    this.disposeOrder = [...deps.disposeOrder];
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    const servicesByName: Record<RuntimeServiceName, RuntimeServiceLifecycle> = {
      providerRegistry: this.providerRegistry,
      embeddingService: this.embeddingService,
      searchService: this.searchService,
      agentService: this.agentService,
      chatService: this.chatService,
      indexingService: this.indexingService
    };

    const orderedEntries: NamedRuntimeService[] = this.disposeOrder
      .slice()
      .reverse()
      .map((name) => ({ name, service: servicesByName[name] }));

    const failures = await disposeRuntimeServices(orderedEntries);
    if (failures.length > 0) {
      console.error("Runtime service disposal encountered errors:", failures.join(" | "));
    }
  }
}
