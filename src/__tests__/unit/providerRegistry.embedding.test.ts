import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../providers/ProviderRegistry";
import type { EmbeddingRequest, EmbeddingResponse, ObsidianAISettings, RuntimeBootstrapContext } from "../../types";

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

describe("ProviderRegistry embedding provider behavior", () => {
  it("registers and resolves providers by explicit and configured IDs", async () => {
    const settings = createSettings();
    const registry = new ProviderRegistry({
      app: {} as RuntimeBootstrapContext["app"],
      plugin: {} as RuntimeBootstrapContext["plugin"],
      getSettings: () => settings,
      notify: () => undefined
    });
    await registry.init();

    const openAIProvider = {
      id: "openai" as const,
      name: "OpenAI",
      embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => ({
        providerId: "openai",
        model: request.model,
        vectors: []
      })
    };
    const ollamaProvider = {
      id: "ollama" as const,
      name: "Ollama",
      embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => ({
        providerId: "ollama",
        model: request.model,
        vectors: []
      })
    };

    registry.registerEmbeddingProvider(openAIProvider);
    registry.registerEmbeddingProvider(ollamaProvider);

    expect(registry.getEmbeddingProvider("openai").name).toBe("OpenAI");

    settings.embeddingProvider = "ollama";
    expect(registry.getEmbeddingProvider().name).toBe("Ollama");
    expect(registry.listEmbeddingProviders().map((provider) => provider.id)).toEqual(["ollama", "openai"]);
  });
});
