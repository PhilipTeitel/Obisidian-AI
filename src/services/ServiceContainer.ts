import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import type {
  AgentServiceContract,
  ChatServiceContract,
  ContextAssemblyServiceContract,
  EmbeddingServiceContract,
  HierarchicalStoreContract,
  IndexingServiceContract,
  NormalizedRuntimeError,
  ProviderRegistryContract,
  RuntimeServiceLifecycle,
  RuntimeServiceName,
  RuntimeServices,
  SearchServiceContract,
  SummaryServiceContract
} from "../types";

export interface NamedRuntimeService {
  name: RuntimeServiceName;
  service: RuntimeServiceLifecycle;
}

export interface RuntimeDisposalFailure {
  name: RuntimeServiceName;
  error: NormalizedRuntimeError;
}

export interface ServiceContainerDeps {
  indexingService: IndexingServiceContract;
  embeddingService: EmbeddingServiceContract;
  searchService: SearchServiceContract;
  chatService: ChatServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
  summaryService: SummaryServiceContract;
  contextAssemblyService: ContextAssemblyServiceContract;
  hierarchicalStore: HierarchicalStoreContract;
  disposeOrder: RuntimeServiceName[];
}

const logger = createRuntimeLogger("ServiceContainer");

export const disposeRuntimeServices = async (
  entries: NamedRuntimeService[]
): Promise<RuntimeDisposalFailure[]> => {
  const failures: RuntimeDisposalFailure[] = [];
  for (const entry of entries) {
    try {
      await entry.service.dispose();
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "runtimeServices.dispose",
        phase: "dispose",
        service: entry.name
      });
      failures.push({ name: entry.name, error: normalized });
      logger.log({
        level: "error",
        event: "runtime.service.dispose_failed",
        message: `Failed to dispose runtime service: ${entry.name}.`,
        domain: normalized.domain,
        context: {
          operation: "runtimeServices.dispose",
          phase: "dispose",
          service: entry.name
        },
        error: normalized
      });
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
  public readonly summaryService: SummaryServiceContract;
  public readonly contextAssemblyService: ContextAssemblyServiceContract;
  public readonly hierarchicalStore: HierarchicalStoreContract;

  private readonly disposeOrder: RuntimeServiceName[];
  private disposed = false;

  public constructor(deps: ServiceContainerDeps) {
    this.indexingService = deps.indexingService;
    this.embeddingService = deps.embeddingService;
    this.searchService = deps.searchService;
    this.chatService = deps.chatService;
    this.agentService = deps.agentService;
    this.providerRegistry = deps.providerRegistry;
    this.summaryService = deps.summaryService;
    this.contextAssemblyService = deps.contextAssemblyService;
    this.hierarchicalStore = deps.hierarchicalStore;
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
      summaryService: this.summaryService,
      searchService: this.searchService,
      contextAssemblyService: this.contextAssemblyService,
      agentService: this.agentService,
      chatService: this.chatService,
      indexingService: this.indexingService
    };

    const orderedEntries: NamedRuntimeService[] = this.disposeOrder
      .slice()
      .reverse()
      .map((name) => ({ name, service: servicesByName[name] }));

    const failures = await disposeRuntimeServices(orderedEntries);

    const hierarchicalLifecycle = this.hierarchicalStore as unknown as RuntimeServiceLifecycle;
    try {
      await hierarchicalLifecycle.dispose();
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "runtimeServices.dispose",
        phase: "dispose",
        service: "hierarchicalStore"
      });
      logger.log({
        level: "error",
        event: "runtime.service.dispose_failed",
        message: "Failed to dispose hierarchical store.",
        domain: normalized.domain,
        context: {
          operation: "runtimeServices.dispose",
          phase: "dispose",
          service: "hierarchicalStore"
        },
        error: normalized
      });
    }

    if (failures.length > 0) {
      logger.log({
        level: "warn",
        event: "runtime.dispose.completed_with_failures",
        message: "Runtime service disposal completed with failures.",
        context: {
          operation: "runtimeServices.dispose",
          failureCount: failures.length
        }
      });
    }
  }
}
