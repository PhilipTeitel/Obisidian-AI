import { describe, expect, it } from "vitest";
import { ServiceContainer } from "../../services/ServiceContainer";
import { SqliteVecRepository } from "../../storage/SqliteVecRepository";
import type {
  AgentServiceContract,
  ChatServiceContract,
  EmbeddingServiceContract,
  HierarchicalStoreContract,
  IndexingServiceContract,
  ProviderRegistryContract,
  RuntimeBootstrapContext,
  RuntimeServiceLifecycle,
  SearchServiceContract
} from "../../types";

interface MemoryPluginLike {
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
}

const createMemoryPlugin = (): MemoryPluginLike => {
  let data: unknown = null;
  return {
    loadData: async () => data,
    saveData: async (nextData) => {
      data = nextData;
    }
  };
};

const createNoopService = (): RuntimeServiceLifecycle => ({
  init: async () => {},
  dispose: async () => {}
});

const createMockServices = () => ({
  providerRegistry: createNoopService() as unknown as ProviderRegistryContract,
  embeddingService: createNoopService() as unknown as EmbeddingServiceContract,
  searchService: createNoopService() as unknown as SearchServiceContract,
  agentService: createNoopService() as unknown as AgentServiceContract,
  chatService: createNoopService() as unknown as ChatServiceContract,
  indexingService: createNoopService() as unknown as IndexingServiceContract
});

describe("STOR-3: Bootstrap hierarchical store wiring", () => {
  describe("Phase A: Bootstrap Wiring", () => {
    it("A1 — SqliteVecRepository can be constructed with plugin deps", () => {
      const plugin = createMemoryPlugin();
      const repo = new SqliteVecRepository({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
        pluginId: "obsidian-ai-mvp"
      });
      expect(repo).toBeDefined();
      expect(typeof repo.init).toBe("function");
      expect(typeof repo.dispose).toBe("function");
    });

    it("A2 — SqliteVecRepository.init() completes successfully", async () => {
      const plugin = createMemoryPlugin();
      const repo = new SqliteVecRepository({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
        pluginId: "obsidian-ai-mvp"
      });
      await expect(repo.init()).resolves.toBeUndefined();
    });

    it("A3 — hierarchicalStore is accessible on ServiceContainer after construction", () => {
      const plugin = createMemoryPlugin();
      const repo = new SqliteVecRepository({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
        pluginId: "obsidian-ai-mvp"
      });

      const container = new ServiceContainer({
        ...createMockServices(),
        hierarchicalStore: repo,
        disposeOrder: ["providerRegistry", "embeddingService", "searchService", "agentService", "chatService", "indexingService"]
      });

      expect(container.hierarchicalStore).toBeDefined();
      expect(container.hierarchicalStore).toBe(repo);
    });
  });

  describe("Phase B: ServiceContainer Update", () => {
    it("B1 — ServiceContainer accepts optional hierarchicalStore in deps", () => {
      const containerWithStore = new ServiceContainer({
        ...createMockServices(),
        hierarchicalStore: {} as HierarchicalStoreContract,
        disposeOrder: ["providerRegistry", "embeddingService", "searchService", "agentService", "chatService", "indexingService"]
      });
      expect(containerWithStore.hierarchicalStore).toBeDefined();

      const containerWithout = new ServiceContainer({
        ...createMockServices(),
        disposeOrder: ["providerRegistry", "embeddingService", "searchService", "agentService", "chatService", "indexingService"]
      });
      expect(containerWithout.hierarchicalStore).toBeUndefined();
    });

    it("B2 — ServiceContainer exposes hierarchicalStore with correct contract methods", async () => {
      const plugin = createMemoryPlugin();
      const repo = new SqliteVecRepository({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
        pluginId: "obsidian-ai-mvp"
      });
      await repo.init();

      const container = new ServiceContainer({
        ...createMockServices(),
        hierarchicalStore: repo,
        disposeOrder: ["providerRegistry", "embeddingService", "searchService", "agentService", "chatService", "indexingService"]
      });

      const store = container.hierarchicalStore!;
      expect(typeof store.upsertNodeTree).toBe("function");
      expect(typeof store.deleteByNotePath).toBe("function");
      expect(typeof store.getNode).toBe("function");
      expect(typeof store.getChildren).toBe("function");
      expect(typeof store.getAncestorChain).toBe("function");
      expect(typeof store.getSiblings).toBe("function");
      expect(typeof store.searchSummaryEmbeddings).toBe("function");
      expect(typeof store.searchContentEmbeddings).toBe("function");
    });
  });

  describe("Phase D: Backward Compatibility", () => {
    it("D1 — ServiceContainer works without hierarchicalStore", async () => {
      const container = new ServiceContainer({
        ...createMockServices(),
        disposeOrder: ["providerRegistry", "embeddingService", "searchService", "agentService", "chatService", "indexingService"]
      });

      expect(container.hierarchicalStore).toBeUndefined();
      expect(container.indexingService).toBeDefined();
      expect(container.searchService).toBeDefined();
      expect(container.chatService).toBeDefined();

      await expect(container.dispose()).resolves.toBeUndefined();
    });
  });
});
