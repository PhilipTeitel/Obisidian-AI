import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import type {
  AgentServiceContract,
  ChatServiceContract,
  EmbeddingServiceContract,
  IndexingServiceContract,
  NormalizedRuntimeError,
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
