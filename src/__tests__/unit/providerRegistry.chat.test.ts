import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../providers/ProviderRegistry";
import type { ChatProvider, ChatRequest, ChatStreamEvent, ObsidianAISettings, RuntimeBootstrapContext } from "../../types";

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

const createChatProvider = (id: "openai" | "ollama", name: string): ChatProvider => {
  return {
    id,
    name,
    async *complete(_request: ChatRequest): AsyncIterable<ChatStreamEvent> {
      void _request;
      yield { type: "done", finishReason: "stop" };
    }
  };
};

describe("ProviderRegistry chat provider behavior", () => {
  it("A1_register_and_resolve_chat_providers", async () => {
    const settings = createSettings();
    const registry = new ProviderRegistry({
      app: {} as RuntimeBootstrapContext["app"],
      plugin: {} as RuntimeBootstrapContext["plugin"],
      getSettings: () => settings,
      notify: () => undefined
    });
    await registry.init();

    const openAIProvider = createChatProvider("openai", "OpenAI Chat");
    const ollamaProvider = createChatProvider("ollama", "Ollama Chat");

    registry.registerChatProvider(openAIProvider);
    registry.registerChatProvider(ollamaProvider);

    expect(registry.getChatProvider("openai").name).toBe("OpenAI Chat");

    settings.chatProvider = "ollama";
    expect(registry.getChatProvider().name).toBe("Ollama Chat");
  });

  it("A2_list_and_missing_provider_behavior", async () => {
    const settings = createSettings();
    const registry = new ProviderRegistry({
      app: {} as RuntimeBootstrapContext["app"],
      plugin: {} as RuntimeBootstrapContext["plugin"],
      getSettings: () => settings,
      notify: () => undefined
    });
    await registry.init();

    registry.registerChatProvider(createChatProvider("openai", "OpenAI Chat"));
    registry.registerChatProvider(createChatProvider("ollama", "Ollama Chat"));

    expect(registry.listChatProviders().map((provider) => provider.id)).toEqual(["ollama", "openai"]);
    expect(() => registry.getChatProvider("missing-provider")).toThrow("Chat provider is not registered: missing-provider");
  });
});
