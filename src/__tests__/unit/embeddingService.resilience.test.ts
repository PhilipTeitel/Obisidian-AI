import { describe, expect, it } from "vitest";
import { EmbeddingService } from "../../services/EmbeddingService";
import { EmbeddingBatchError } from "../../services/errors/EmbeddingBatchError";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  ObsidianAISettings,
  ProviderRegistryContract
} from "../../types";

const createSettings = (): ObsidianAISettings => {
  return {
    embeddingProvider: "openai",
    chatProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    chatModel: "gpt-4o-mini",
    ollamaEndpoint: "http://localhost:11434",
    openaiEndpoint: "https://api.openai.com/v1",
    indexedFolders: ["/"],
    excludedFolders: [],
    agentOutputFolders: [],
    maxGeneratedNoteSize: 5000,
    chatTimeout: 30000
  };
};

const createRegistry = (provider: EmbeddingProvider): ProviderRegistryContract => {
  return {
    init: async () => undefined,
    dispose: async () => undefined,
    getEmbeddingProviderId: () => "openai",
    getChatProviderId: () => "openai",
    registerEmbeddingProvider: () => undefined,
    getEmbeddingProvider: () => provider,
    listEmbeddingProviders: () => [provider],
    registerChatProvider: () => undefined,
    getChatProvider: () => {
      throw new Error("Not needed for embedding tests.");
    },
    listChatProviders: () => []
  };
};

describe("EmbeddingService resilience", () => {
  it("splits requests into batches and preserves output ordering", async () => {
    const batchSizes: number[] = [];
    const provider: EmbeddingProvider = {
      id: "openai",
      name: "OpenAI",
      embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
        batchSizes.push(request.inputs.length);
        return {
          providerId: "openai",
          model: request.model,
          vectors: request.inputs.map((_, index) => ({
            values: [index + 1, 0],
            dimensions: 2
          }))
        };
      }
    };

    const service = new EmbeddingService({
      providerRegistry: createRegistry(provider),
      getSettings: () => createSettings()
    });
    await service.init();

    const response = await service.embed({
      providerId: "openai",
      model: "text-embedding-3-small",
      inputs: ["a", "b", "c", "d", "e"],
      batchSize: 2
    });

    expect(batchSizes).toEqual([2, 2, 1]);
    expect(response.vectors).toHaveLength(5);
  });

  it("retries failed provider calls and succeeds before retry budget is exhausted", async () => {
    let callCount = 0;
    const provider: EmbeddingProvider = {
      id: "openai",
      name: "OpenAI",
      embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("transient failure");
        }
        return {
          providerId: "openai",
          model: request.model,
          vectors: request.inputs.map(() => ({ values: [1, 0], dimensions: 2 }))
        };
      }
    };

    const service = new EmbeddingService({
      providerRegistry: createRegistry(provider),
      getSettings: () => createSettings()
    });
    await service.init();

    const response = await service.embed({
      providerId: "openai",
      model: "text-embedding-3-small",
      inputs: ["retry-me"],
      maxRetries: 1
    });

    expect(callCount).toBe(2);
    expect(response.vectors).toHaveLength(1);
  });

  it("throws EmbeddingBatchError with failed indexes when retries are exhausted", async () => {
    const provider: EmbeddingProvider = {
      id: "openai",
      name: "OpenAI",
      embed: async () => {
        throw new Error("permanent failure");
      }
    };

    const service = new EmbeddingService({
      providerRegistry: createRegistry(provider),
      getSettings: () => createSettings()
    });
    await service.init();

    await expect(
      service.embed({
        providerId: "openai",
        model: "text-embedding-3-small",
        inputs: ["a", "b", "c"],
        batchSize: 2,
        maxRetries: 0
      })
    ).rejects.toBeInstanceOf(EmbeddingBatchError);
  });
});
