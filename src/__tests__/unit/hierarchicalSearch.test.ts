import { describe, expect, it, vi } from "vitest";
import { SearchService, type SearchServiceDeps } from "../../services/SearchService";
import type {
  EmbeddingServiceContract,
  EmbeddingVector,
  HierarchicalStoreContract,
  NodeMatch,
  ObsidianAISettings,
  VectorStoreRepositoryContract
} from "../../types";

const createQueryVector = (): EmbeddingVector => ({
  values: [0.1, 0.2, 0.3],
  dimensions: 3
});

const createMockEmbeddingService = (vector?: EmbeddingVector): EmbeddingServiceContract => ({
  init: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  embed: vi.fn().mockResolvedValue({
    providerId: "openai",
    model: "text-embedding-3-small",
    vectors: [vector ?? createQueryVector()]
  })
});

const createMockVectorStore = (): VectorStoreRepositoryContract => ({
  getSchemaMetadata: vi.fn(),
  replaceAllFromChunks: vi.fn(),
  upsertFromChunks: vi.fn(),
  deleteByNotePaths: vi.fn(),
  queryNearestNeighbors: vi.fn().mockResolvedValue([])
});

const createMockHierarchicalStore = (matches: NodeMatch[] = []): HierarchicalStoreContract => ({
  upsertNodeTree: vi.fn(),
  deleteByNotePath: vi.fn(),
  getNode: vi.fn(),
  getChildren: vi.fn(),
  getAncestorChain: vi.fn(),
  getSiblings: vi.fn(),
  getNodesByNotePath: vi.fn(),
  searchSummaryEmbeddings: vi.fn().mockResolvedValue(matches),
  searchContentEmbeddings: vi.fn(),
  upsertSummary: vi.fn(),
  getSummary: vi.fn(),
  upsertEmbedding: vi.fn(),
  upsertTags: vi.fn(),
  upsertCrossReferences: vi.fn(),
  getCrossReferences: vi.fn()
});

const createSettings = (): ObsidianAISettings => ({
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
  chatTimeout: 30000,
  logLevel: "info"
});

const createDeps = (overrides?: Partial<SearchServiceDeps>): SearchServiceDeps => ({
  embeddingService: createMockEmbeddingService(),
  vectorStoreRepository: createMockVectorStore(),
  getSettings: () => createSettings(),
  hierarchicalStore: createMockHierarchicalStore(),
  ...overrides
});

describe("SearchService — Phase 1 Hierarchical Search", () => {
  describe("Phase A: Service Extension", () => {
    it("A1 — deps include hierarchical store", () => {
      const store = createMockHierarchicalStore();
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      expect(service).toBeDefined();
    });

    it("A2 — HierarchicalSearchRequest type is usable", async () => {
      const service = new SearchService(createDeps());
      await service.init();
      const result = await service.hierarchicalSearchPhase1({
        query: "test",
        topK: 10,
        minScore: 0.5
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Phase B: Phase 1 Search Logic", () => {
    it("B1 — embeds the query using EmbeddingService", async () => {
      const embeddingService = createMockEmbeddingService();
      const deps = createDeps({ embeddingService });
      const service = new SearchService(deps);
      await service.init();

      await service.hierarchicalSearchPhase1({ query: "semantic search", topK: 10 });

      expect(embeddingService.embed).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: ["semantic search"]
        })
      );
    });

    it("B2 — searches summary embeddings via HierarchicalStoreContract", async () => {
      const summaryMatches: NodeMatch[] = [
        { nodeId: "node-1", score: 0.95, embeddingType: "summary" },
        { nodeId: "node-2", score: 0.85, embeddingType: "summary" }
      ];
      const store = createMockHierarchicalStore(summaryMatches);
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const results = await service.hierarchicalSearchPhase1({ query: "test query", topK: 10 });

      expect(store.searchSummaryEmbeddings).toHaveBeenCalledWith(createQueryVector(), 10);
      expect(results).toHaveLength(2);
      expect(results[0].nodeId).toBe("node-1");
      expect(results[1].nodeId).toBe("node-2");
    });

    it("B3 — filters by minScore when provided", async () => {
      const summaryMatches: NodeMatch[] = [
        { nodeId: "node-1", score: 0.95, embeddingType: "summary" },
        { nodeId: "node-2", score: 0.85, embeddingType: "summary" },
        { nodeId: "node-3", score: 0.60, embeddingType: "summary" }
      ];
      const store = createMockHierarchicalStore(summaryMatches);
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const results = await service.hierarchicalSearchPhase1({
        query: "test query",
        topK: 10,
        minScore: 0.80
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.score >= 0.80)).toBe(true);
    });

    it("B4 — empty query returns empty array", async () => {
      const embeddingService = createMockEmbeddingService();
      const deps = createDeps({ embeddingService });
      const service = new SearchService(deps);
      await service.init();

      const results = await service.hierarchicalSearchPhase1({ query: "   ", topK: 10 });

      expect(results).toHaveLength(0);
      expect(embeddingService.embed).not.toHaveBeenCalled();
    });

    it("B5 — non-positive topK returns empty array", async () => {
      const embeddingService = createMockEmbeddingService();
      const deps = createDeps({ embeddingService });
      const service = new SearchService(deps);
      await service.init();

      const results = await service.hierarchicalSearchPhase1({ query: "test", topK: 0 });

      expect(results).toHaveLength(0);
      expect(embeddingService.embed).not.toHaveBeenCalled();
    });
  });

  describe("Phase C: Structured Logging", () => {
    it("C1 — emits retrieval.phase1.completed event on success", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const summaryMatches: NodeMatch[] = [
        { nodeId: "node-1", score: 0.95, embeddingType: "summary" }
      ];
      const store = createMockHierarchicalStore(summaryMatches);
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      await service.hierarchicalSearchPhase1({ query: "test", topK: 10 });

      const phase1Event = infoSpy.mock.calls.find(
        (call) =>
          call[0] &&
          typeof call[0] === "object" &&
          (call[0] as Record<string, unknown>).event === "retrieval.phase1.completed"
      );
      expect(phase1Event).toBeDefined();
      const payload = phase1Event![0] as Record<string, unknown>;
      expect(payload.event).toBe("retrieval.phase1.completed");
      expect((payload.context as Record<string, unknown>).resultCount).toBe(1);

      infoSpy.mockRestore();
    });

    it("C2 — emits retrieval.phase1.failed event on error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const embeddingService = createMockEmbeddingService();
      (embeddingService.embed as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Embedding failed")
      );
      const deps = createDeps({ embeddingService });
      const service = new SearchService(deps);
      await service.init();

      await expect(
        service.hierarchicalSearchPhase1({ query: "test", topK: 10 })
      ).rejects.toThrow();

      const failedEvent = errorSpy.mock.calls.find(
        (call) =>
          call[0] &&
          typeof call[0] === "object" &&
          (call[0] as Record<string, unknown>).event === "retrieval.phase1.failed"
      );
      expect(failedEvent).toBeDefined();

      errorSpy.mockRestore();
    });
  });

  describe("Phase D: Error Handling", () => {
    it("D1 — disposed service throws on hierarchicalSearchPhase1", async () => {
      const service = new SearchService(createDeps());
      await service.init();
      await service.dispose();

      await expect(
        service.hierarchicalSearchPhase1({ query: "test", topK: 10 })
      ).rejects.toThrow("SearchService is disposed.");
    });
  });
});
