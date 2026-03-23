import { describe, expect, it, vi } from "vitest";
import { SearchService, type SearchServiceDeps } from "../../services/SearchService";
import type {
  DocumentNode,
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
  getNodesByTag: vi.fn().mockResolvedValue([]),
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
  logLevel: "info",
  summaryMaxTokens: 100,
  matchedContentBudget: 2000,
  siblingContextBudget: 1000,
  parentSummaryBudget: 1000
});

const createNode = (overrides: Partial<DocumentNode> & { nodeId: string }): DocumentNode => ({
  nodeId: overrides.nodeId,
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  notePath: overrides.notePath ?? "notes/test.md",
  noteTitle: overrides.noteTitle ?? "Test Note",
  headingTrail: overrides.headingTrail ?? [],
  depth: overrides.depth ?? 0,
  nodeType: overrides.nodeType ?? "note",
  content: overrides.content ?? "Test content",
  sequenceIndex: overrides.sequenceIndex ?? 0,
  tags: overrides.tags ?? [],
  contentHash: overrides.contentHash ?? "abc123",
  updatedAt: overrides.updatedAt ?? 1000
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

describe("SearchService — Phase 2 Drill-Down Search", () => {
  describe("Phase A: Drill-Down Logic", () => {
    it("A1 — searches children content embeddings for each candidate", async () => {
      const leafNode = createNode({
        nodeId: "leaf-1",
        parentId: "topic-1",
        nodeType: "paragraph",
        depth: 2,
        content: "Leaf content"
      });
      const store = createMockHierarchicalStore();
      (store.getNode as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === "topic-1") {
          return createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1, childIds: ["leaf-1"] });
        }
        if (id === "leaf-1") return leafNode;
        return null;
      });
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: "leaf-1", score: 0.9, embeddingType: "content" }
      ]);
      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([
        createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1 })
      ]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [{ nodeId: "topic-1", score: 0.95, embeddingType: "summary" }];
      const results = await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);

      expect(store.searchContentEmbeddings).toHaveBeenCalledWith(createQueryVector(), 5, "topic-1");
      expect(results).toHaveLength(1);
      expect(results[0].node.nodeId).toBe("leaf-1");
    });

    it("A2 — recursively drills into non-leaf children", async () => {
      const store = createMockHierarchicalStore();
      (store.getNode as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === "topic-1") {
          return createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1, childIds: ["subtopic-1"] });
        }
        if (id === "subtopic-1") {
          return createNode({ nodeId: "subtopic-1", nodeType: "subtopic", depth: 2, parentId: "topic-1", childIds: ["para-1"] });
        }
        if (id === "para-1") {
          return createNode({ nodeId: "para-1", nodeType: "paragraph", depth: 3, parentId: "subtopic-1" });
        }
        return null;
      });
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockImplementation(
        async (_vec: EmbeddingVector, _topK: number, parentId?: string) => {
          if (parentId === "topic-1") {
            return [{ nodeId: "subtopic-1", score: 0.88, embeddingType: "content" }];
          }
          if (parentId === "subtopic-1") {
            return [{ nodeId: "para-1", score: 0.92, embeddingType: "content" }];
          }
          return [];
        }
      );
      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([
        createNode({ nodeId: "subtopic-1", nodeType: "subtopic", depth: 2 }),
        createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1 })
      ]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [{ nodeId: "topic-1", score: 0.95, embeddingType: "summary" }];
      const results = await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);

      expect(results).toHaveLength(1);
      expect(results[0].node.nodeId).toBe("para-1");
      expect(results[0].score).toBe(0.92);
    });

    it("A3 — collects leaf nodes as final matches", async () => {
      const store = createMockHierarchicalStore();
      (store.getNode as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === "topic-1") {
          return createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1, childIds: ["para-1", "para-2"] });
        }
        if (id === "para-1") {
          return createNode({ nodeId: "para-1", nodeType: "paragraph", depth: 2, parentId: "topic-1" });
        }
        if (id === "para-2") {
          return createNode({ nodeId: "para-2", nodeType: "paragraph", depth: 2, parentId: "topic-1" });
        }
        return null;
      });
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: "para-1", score: 0.9, embeddingType: "content" },
        { nodeId: "para-2", score: 0.85, embeddingType: "content" }
      ]);
      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [{ nodeId: "topic-1", score: 0.95, embeddingType: "summary" }];
      const results = await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);

      expect(results).toHaveLength(2);
      expect(results[0].node.nodeType).toBe("paragraph");
      expect(results[1].node.nodeType).toBe("paragraph");
    });

    it("A4 — deduplicates leaf nodes across ancestor paths", async () => {
      const store = createMockHierarchicalStore();
      const sharedLeaf = createNode({ nodeId: "para-1", nodeType: "paragraph", depth: 2, parentId: "topic-1" });
      (store.getNode as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === "topic-1" || id === "topic-2") {
          return createNode({ nodeId: id, nodeType: "topic", depth: 1, childIds: ["para-1"] });
        }
        if (id === "para-1") return sharedLeaf;
        return null;
      });
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockImplementation(
        async (_vec: EmbeddingVector, _topK: number, parentId?: string) => {
          if (parentId === "topic-1") {
            return [{ nodeId: "para-1", score: 0.85, embeddingType: "content" }];
          }
          if (parentId === "topic-2") {
            return [{ nodeId: "para-1", score: 0.90, embeddingType: "content" }];
          }
          return [];
        }
      );
      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [
        { nodeId: "topic-1", score: 0.95, embeddingType: "summary" },
        { nodeId: "topic-2", score: 0.90, embeddingType: "summary" }
      ];
      const results = await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);

      expect(results).toHaveLength(1);
      expect(results[0].node.nodeId).toBe("para-1");
      expect(results[0].score).toBe(0.90);
    });

    it("A5 — each LeafMatch includes the ancestor chain", async () => {
      const store = createMockHierarchicalStore();
      (store.getNode as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === "topic-1") {
          return createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1, childIds: ["para-1"] });
        }
        if (id === "para-1") {
          return createNode({ nodeId: "para-1", nodeType: "paragraph", depth: 2, parentId: "topic-1" });
        }
        return null;
      });
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: "para-1", score: 0.9, embeddingType: "content" }
      ]);
      const topicNode = createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1 });
      const noteNode = createNode({ nodeId: "note-1", nodeType: "note", depth: 0 });
      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([topicNode, noteNode]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [{ nodeId: "topic-1", score: 0.95, embeddingType: "summary" }];
      const results = await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);

      expect(results).toHaveLength(1);
      expect(results[0].ancestorChain).toHaveLength(2);
      expect(results[0].ancestorChain[0].nodeId).toBe("topic-1");
      expect(results[0].ancestorChain[1].nodeId).toBe("note-1");
    });
  });

  describe("Phase B: Edge Cases", () => {
    it("B1 — empty candidates array returns empty results", async () => {
      const service = new SearchService(createDeps());
      await service.init();

      const results = await service.hierarchicalSearchPhase2([], createQueryVector(), 10);
      expect(results).toHaveLength(0);
    });

    it("B2 — candidates with no children return empty results", async () => {
      const store = createMockHierarchicalStore();
      (store.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(
        createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1, childIds: [] })
      );
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (store.getChildren as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [{ nodeId: "topic-1", score: 0.95, embeddingType: "summary" }];
      const results = await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);
      expect(results).toHaveLength(0);
    });
  });

  describe("Phase C: Structured Logging", () => {
    it("C1 — emits retrieval.phase2.completed event on success", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const store = createMockHierarchicalStore();
      (store.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(
        createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1 })
      );
      (store.searchContentEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (store.getChildren as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SearchService(deps);
      await service.init();

      const candidates: NodeMatch[] = [{ nodeId: "topic-1", score: 0.95, embeddingType: "summary" }];
      await service.hierarchicalSearchPhase2(candidates, createQueryVector(), 10);

      const phase2Event = infoSpy.mock.calls.find(
        (call) =>
          call[0] &&
          typeof call[0] === "object" &&
          (call[0] as Record<string, unknown>).event === "retrieval.phase2.completed"
      );
      expect(phase2Event).toBeDefined();

      infoSpy.mockRestore();
    });
  });
});
