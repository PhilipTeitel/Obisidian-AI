import { ProviderRegistry } from "../providers/ProviderRegistry";
import { AgentService } from "../services/AgentService";
import { ChatService } from "../services/ChatService";
import { EmbeddingService } from "../services/EmbeddingService";
import { IndexingService } from "../services/IndexingService";
import { SearchService } from "../services/SearchService";
import { ServiceContainer, type NamedRuntimeService } from "../services/ServiceContainer";
import type {
  RuntimeBootstrapContext,
  RuntimeBootstrapResult,
  RuntimeServiceLifecycle,
  RuntimeServiceName
} from "../types";
import { RUNTIME_SERVICE_CONSTRUCTION_ORDER } from "../types";

const initService = async (
  initializationOrder: RuntimeServiceName[],
  name: RuntimeServiceName,
  service: RuntimeServiceLifecycle
): Promise<void> => {
  await service.init();
  initializationOrder.push(name);
};

const disposePartial = async (initializedServices: NamedRuntimeService[]): Promise<void> => {
  for (const initializedService of initializedServices.slice().reverse()) {
    try {
      await initializedService.service.dispose();
    } catch (error: unknown) {
      console.error(`Failed to dispose partially initialized service: ${initializedService.name}`, error);
    }
  }
};

export const bootstrapRuntimeServices = async (
  context: RuntimeBootstrapContext
): Promise<RuntimeBootstrapResult> => {
  const initializationOrder: RuntimeServiceName[] = [];
  const initializedServices: NamedRuntimeService[] = [];

  const providerRegistry = new ProviderRegistry(context);
  const embeddingService = new EmbeddingService({
    providerRegistry,
    getSettings: context.getSettings
  });
  const searchService = new SearchService({
    embeddingService,
    getSettings: context.getSettings
  });
  const agentService = new AgentService({
    getSettings: context.getSettings,
    notify: context.notify
  });
  const chatService = new ChatService({
    searchService,
    agentService,
    providerRegistry
  });
  const indexingService = new IndexingService({
    embeddingService,
    getSettings: context.getSettings
  });

  const servicesByName: Record<RuntimeServiceName, RuntimeServiceLifecycle> = {
    providerRegistry,
    embeddingService,
    searchService,
    agentService,
    chatService,
    indexingService
  };

  try {
    for (const name of RUNTIME_SERVICE_CONSTRUCTION_ORDER) {
      const service = servicesByName[name];
      await initService(initializationOrder, name, service);
      initializedServices.push({ name, service });
    }

    const services = new ServiceContainer({
      providerRegistry,
      embeddingService,
      searchService,
      agentService,
      chatService,
      indexingService,
      disposeOrder: [...RUNTIME_SERVICE_CONSTRUCTION_ORDER]
    });

    return {
      services,
      initializationOrder
    };
  } catch (error: unknown) {
    await disposePartial(initializedServices);
    throw error;
  }
};
