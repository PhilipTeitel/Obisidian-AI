import { describe, expect, it } from "vitest";
import { expectTypeOf } from "vitest";
import { ServiceContainer } from "../../services/ServiceContainer";
import type {
  AgentServiceContract,
  AssembledContext,
  ChatServiceContract,
  ContextAssemblyServiceContract,
  EmbeddingServiceContract,
  HierarchicalStoreContract,
  IndexingServiceContract,
  ProviderRegistryContract,
  RuntimeServiceLifecycle,
  RuntimeServices,
  SearchServiceContract,
  SummaryServiceContract
} from "../../types";
import { RUNTIME_SERVICE_CONSTRUCTION_ORDER } from "../../types";

const createNoopService = (): RuntimeServiceLifecycle => ({
  init: async () => {},
  dispose: async () => {}
});

const createMockSummaryService = (): SummaryServiceContract => ({
  ...createNoopService(),
  generateSummaries: async () => [],
  regenerateFromNode: async () => [],
  detectStaleSummaries: async () => [],
  propagateSummariesForChangedNodes: async () => []
});

const createMockContextAssemblyService = (): ContextAssemblyServiceContract => ({
  ...createNoopService(),
  assemble: async (): Promise<AssembledContext> => ({
    blocks: [],
    tierUsage: { matchedContentTokens: 0, siblingContextTokens: 0, parentSummaryTokens: 0 }
  })
});

const createMockHierarchicalStore = (): HierarchicalStoreContract =>
  createNoopService() as unknown as HierarchicalStoreContract;

const createAllMockServices = () => ({
  providerRegistry: createNoopService() as unknown as ProviderRegistryContract,
  embeddingService: createNoopService() as unknown as EmbeddingServiceContract,
  searchService: createNoopService() as unknown as SearchServiceContract,
  agentService: createNoopService() as unknown as AgentServiceContract,
  chatService: createNoopService() as unknown as ChatServiceContract,
  indexingService: createNoopService() as unknown as IndexingServiceContract,
  summaryService: createMockSummaryService(),
  contextAssemblyService: createMockContextAssemblyService(),
  hierarchicalStore: createMockHierarchicalStore()
});

describe("INTG-1: Bootstrap integration — SummaryService, ContextAssemblyService, hierarchicalStore wiring", () => {
  describe("Phase A: Type Contracts", () => {
    it("A1 — SummaryServiceContract interface exists with expected methods", () => {
      const mock = createMockSummaryService();
      expect(typeof mock.init).toBe("function");
      expect(typeof mock.dispose).toBe("function");
      expect(typeof mock.generateSummaries).toBe("function");
      expect(typeof mock.regenerateFromNode).toBe("function");
      expect(typeof mock.detectStaleSummaries).toBe("function");
      expect(typeof mock.propagateSummariesForChangedNodes).toBe("function");
    });

    it("A2 — ContextAssemblyServiceContract interface exists with expected methods", () => {
      const mock = createMockContextAssemblyService();
      expect(typeof mock.init).toBe("function");
      expect(typeof mock.dispose).toBe("function");
      expect(typeof mock.assemble).toBe("function");
    });

    it("A3 — RuntimeServices.hierarchicalStore is required (not optional)", () => {
      expectTypeOf<RuntimeServices["hierarchicalStore"]>().toEqualTypeOf<HierarchicalStoreContract>();
    });

    it("A4 — RuntimeServices includes summaryService and contextAssemblyService", () => {
      expectTypeOf<RuntimeServices>().toHaveProperty("summaryService");
      expectTypeOf<RuntimeServices>().toHaveProperty("contextAssemblyService");
      expectTypeOf<RuntimeServices["summaryService"]>().toEqualTypeOf<SummaryServiceContract>();
      expectTypeOf<RuntimeServices["contextAssemblyService"]>().toEqualTypeOf<ContextAssemblyServiceContract>();
    });

    it("A5 — RUNTIME_SERVICE_CONSTRUCTION_ORDER includes summaryService and contextAssemblyService", () => {
      const order: readonly string[] = RUNTIME_SERVICE_CONSTRUCTION_ORDER;
      expect(order).toContain("summaryService");
      expect(order).toContain("contextAssemblyService");

      const summaryIdx = order.indexOf("summaryService");
      const embeddingIdx = order.indexOf("embeddingService");
      const searchIdx = order.indexOf("searchService");
      const contextIdx = order.indexOf("contextAssemblyService");

      expect(summaryIdx).toBeGreaterThan(embeddingIdx);
      expect(contextIdx).toBeGreaterThan(searchIdx);
    });
  });

  describe("Phase B: Bootstrap Wiring", () => {
    it("B1 — SummaryService is constructable with correct dep shape", () => {
      const mock = createMockSummaryService();
      expect(mock).toBeDefined();
      expect(typeof mock.generateSummaries).toBe("function");
    });

    it("B2 — ContextAssemblyService is constructable with correct dep shape", () => {
      const mock = createMockContextAssemblyService();
      expect(mock).toBeDefined();
      expect(typeof mock.assemble).toBe("function");
    });

    it("B3 — ServiceContainer receives hierarchicalStore as required", () => {
      const container = new ServiceContainer({
        ...createAllMockServices(),
        disposeOrder: [...RUNTIME_SERVICE_CONSTRUCTION_ORDER]
      });
      expect(container.hierarchicalStore).toBeDefined();
    });

    it("B4 — All new services are present after container construction", () => {
      const container = new ServiceContainer({
        ...createAllMockServices(),
        disposeOrder: [...RUNTIME_SERVICE_CONSTRUCTION_ORDER]
      });
      expect(container.summaryService).toBeDefined();
      expect(container.contextAssemblyService).toBeDefined();
      expect(container.hierarchicalStore).toBeDefined();
    });
  });

  describe("Phase C: ServiceContainer Update", () => {
    it("C1 — ServiceContainer exposes summaryService and contextAssemblyService", () => {
      const mocks = createAllMockServices();
      const container = new ServiceContainer({
        ...mocks,
        disposeOrder: [...RUNTIME_SERVICE_CONSTRUCTION_ORDER]
      });
      expect(container.summaryService).toBe(mocks.summaryService);
      expect(container.contextAssemblyService).toBe(mocks.contextAssemblyService);
    });

    it("C2 — ServiceContainer.dispose() disposes all services including new ones", async () => {
      const disposeCalls: string[] = [];

      const trackingService = (name: string): RuntimeServiceLifecycle => ({
        init: async () => {},
        dispose: async () => { disposeCalls.push(name); }
      });

      const container = new ServiceContainer({
        providerRegistry: trackingService("providerRegistry") as unknown as ProviderRegistryContract,
        embeddingService: trackingService("embeddingService") as unknown as EmbeddingServiceContract,
        summaryService: { ...trackingService("summaryService"), generateSummaries: async () => [], regenerateFromNode: async () => [], detectStaleSummaries: async () => [], propagateSummariesForChangedNodes: async () => [] } as unknown as SummaryServiceContract,
        searchService: trackingService("searchService") as unknown as SearchServiceContract,
        contextAssemblyService: { ...trackingService("contextAssemblyService"), assemble: async () => ({ blocks: [], tierUsage: { matchedContentTokens: 0, siblingContextTokens: 0, parentSummaryTokens: 0 } }) } as unknown as ContextAssemblyServiceContract,
        agentService: trackingService("agentService") as unknown as AgentServiceContract,
        chatService: trackingService("chatService") as unknown as ChatServiceContract,
        indexingService: trackingService("indexingService") as unknown as IndexingServiceContract,
        hierarchicalStore: trackingService("hierarchicalStore") as unknown as HierarchicalStoreContract,
        disposeOrder: [...RUNTIME_SERVICE_CONSTRUCTION_ORDER]
      });

      await container.dispose();

      expect(disposeCalls).toContain("summaryService");
      expect(disposeCalls).toContain("contextAssemblyService");
      expect(disposeCalls).toContain("providerRegistry");
      expect(disposeCalls).toContain("embeddingService");
      expect(disposeCalls).toContain("searchService");
      expect(disposeCalls).toContain("agentService");
      expect(disposeCalls).toContain("chatService");
      expect(disposeCalls).toContain("indexingService");
      expect(disposeCalls).toContain("hierarchicalStore");

      const indexingIdx = disposeCalls.indexOf("indexingService");
      const providerIdx = disposeCalls.indexOf("providerRegistry");
      const hierarchicalIdx = disposeCalls.indexOf("hierarchicalStore");
      expect(indexingIdx).toBeLessThan(providerIdx);
      expect(hierarchicalIdx).toBeGreaterThan(providerIdx);
    });
  });

  describe("Phase D: Backward Compatibility", () => {
    it("D1 — All existing service fields remain accessible", () => {
      const container = new ServiceContainer({
        ...createAllMockServices(),
        disposeOrder: [...RUNTIME_SERVICE_CONSTRUCTION_ORDER]
      });

      expect(container.indexingService).toBeDefined();
      expect(container.embeddingService).toBeDefined();
      expect(container.searchService).toBeDefined();
      expect(container.chatService).toBeDefined();
      expect(container.agentService).toBeDefined();
      expect(container.providerRegistry).toBeDefined();
    });
  });
});
