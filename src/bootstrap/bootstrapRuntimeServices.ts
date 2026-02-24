import { ProviderRegistry } from "../providers/ProviderRegistry";
import { OpenAIChatProvider } from "../providers/chat/OpenAIChatProvider";
import { OllamaChatProvider } from "../providers/chat/OllamaChatProvider";
import { OllamaEmbeddingProvider } from "../providers/embeddings/OllamaEmbeddingProvider";
import { OpenAIEmbeddingProvider } from "../providers/embeddings/OpenAIEmbeddingProvider";
import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import { PluginSecretStore } from "../secrets/PluginSecretStore";
import { AgentService } from "../services/AgentService";
import { ChatService } from "../services/ChatService";
import { EmbeddingService } from "../services/EmbeddingService";
import { IndexingService } from "../services/IndexingService";
import { IndexJobStateStore } from "../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../services/indexing/IndexManifestStore";
import { SearchService } from "../services/SearchService";
import { ServiceContainer, type NamedRuntimeService } from "../services/ServiceContainer";
import { LocalVectorStoreRepository } from "../storage/LocalVectorStoreRepository";
import type {
  NormalizedRuntimeError,
  RuntimeBootstrapContext,
  RuntimeBootstrapResult,
  RuntimeServiceLifecycle,
  RuntimeServiceName
} from "../types";
import { RUNTIME_SERVICE_CONSTRUCTION_ORDER } from "../types";

const logger = createRuntimeLogger("bootstrapRuntimeServices");

const isNormalizedRuntimeError = (error: unknown): error is NormalizedRuntimeError => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as Partial<NormalizedRuntimeError>;
  return (
    typeof maybeError.code === "string" &&
    typeof maybeError.message === "string" &&
    typeof maybeError.userMessage === "string" &&
    typeof maybeError.retryable === "boolean" &&
    typeof maybeError.domain === "string"
  );
};

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
      const normalized = normalizeRuntimeError(error, {
        operation: "bootstrapRuntimeServices",
        phase: "dispose",
        service: initializedService.name
      });
      logger.log({
        level: "error",
        event: "runtime.service.dispose_failed",
        message: `Failed to dispose partially initialized service: ${initializedService.name}`,
        domain: normalized.domain,
        context: {
          operation: "bootstrapRuntimeServices",
          phase: "dispose",
          service: initializedService.name
        },
        error: normalized
      });
    }
  }
};

export const bootstrapRuntimeServices = async (
  context: RuntimeBootstrapContext
): Promise<RuntimeBootstrapResult> => {
  logger.log({
    level: "info",
    event: "runtime.bootstrap.start",
    message: "Starting runtime service bootstrap."
  });

  const initializationOrder: RuntimeServiceName[] = [];
  const initializedServices: NamedRuntimeService[] = [];

  const providerRegistry = new ProviderRegistry(context);
  const secretStore = new PluginSecretStore(context.plugin);
  const pluginWithManifest = context.plugin as RuntimeBootstrapContext["plugin"] & {
    manifest?: { id?: string };
  };
  const pluginId = pluginWithManifest.manifest?.id ?? "obsidian-ai-mvp";
  const vectorStoreRepository = new LocalVectorStoreRepository({
    plugin: context.plugin,
    pluginId
  });

  providerRegistry.registerEmbeddingProvider(
    new OpenAIEmbeddingProvider({
      getEndpoint: () => context.getSettings().openaiEndpoint,
      getApiKey: () => secretStore.getSecret("openai-api-key")
    })
  );
  providerRegistry.registerEmbeddingProvider(
    new OllamaEmbeddingProvider({
      getEndpoint: () => context.getSettings().ollamaEndpoint
    })
  );
  providerRegistry.registerChatProvider(
    new OpenAIChatProvider({
      getEndpoint: () => context.getSettings().openaiEndpoint,
      getApiKey: () => secretStore.getSecret("openai-api-key")
    })
  );
  providerRegistry.registerChatProvider(
    new OllamaChatProvider({
      getEndpoint: () => context.getSettings().ollamaEndpoint
    })
  );

  const embeddingService = new EmbeddingService({
    providerRegistry,
    getSettings: context.getSettings
  });
  const searchService = new SearchService({
    embeddingService,
    vectorStoreRepository,
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
    app: context.app,
    embeddingService,
    vectorStoreRepository,
    getSettings: context.getSettings,
    manifestStore: new IndexManifestStore({
      plugin: context.plugin
    }),
    jobStateStore: new IndexJobStateStore({
      plugin: context.plugin
    })
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
      logger.log({
        level: "info",
        event: "runtime.service.init_start",
        message: `Initializing runtime service: ${name}.`,
        context: {
          operation: "bootstrapRuntimeServices",
          phase: "init",
          service: name
        }
      });
      try {
        await initService(initializationOrder, name, service);
        initializedServices.push({ name, service });
        logger.log({
          level: "info",
          event: "runtime.service.init_succeeded",
          message: `Initialized runtime service: ${name}.`,
          context: {
            operation: "bootstrapRuntimeServices",
            phase: "init",
            service: name
          }
        });
      } catch (error: unknown) {
        const normalized = normalizeRuntimeError(error, {
          operation: "bootstrapRuntimeServices",
          phase: "init",
          service: name
        });
        logger.log({
          level: "error",
          event: "runtime.service.init_failed",
          message: `Failed to initialize runtime service: ${name}.`,
          domain: normalized.domain,
          context: {
            operation: "bootstrapRuntimeServices",
            phase: "init",
            service: name
          },
          error: normalized
        });
        throw normalized;
      }
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

    logger.log({
      level: "info",
      event: "runtime.bootstrap.succeeded",
      message: "Runtime service bootstrap completed successfully."
    });

    return {
      services,
      initializationOrder
    };
  } catch (error: unknown) {
    await disposePartial(initializedServices);
    const normalized = isNormalizedRuntimeError(error)
      ? error
      : normalizeRuntimeError(error, {
          operation: "bootstrapRuntimeServices",
          phase: "bootstrap"
        });
    logger.log({
      level: "error",
      event: "runtime.bootstrap.failed",
      message: "Runtime service bootstrap failed.",
      domain: normalized.domain,
      context: {
        operation: "bootstrapRuntimeServices",
        phase: "bootstrap"
      },
      error: normalized
    });
    throw normalized;
  }
};
