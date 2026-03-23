import { describe, expect, it, vi } from "vitest";
import {
  ContextAssemblyService,
  DEFAULT_MATCHED_CONTENT_BUDGET,
  DEFAULT_SIBLING_CONTEXT_BUDGET,
  DEFAULT_PARENT_SUMMARY_BUDGET,
  type ContextAssemblyServiceDeps
} from "../../services/ContextAssemblyService";
import type {
  DocumentNode,
  HierarchicalStoreContract,
  LeafMatch,
  ObsidianAISettings,
  SummaryRecord
} from "../../types";

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

const createMockStore = (): HierarchicalStoreContract => ({
  upsertNodeTree: vi.fn(),
  deleteByNotePath: vi.fn(),
  getNode: vi.fn(),
  getChildren: vi.fn(),
  getAncestorChain: vi.fn().mockResolvedValue([]),
  getSiblings: vi.fn().mockResolvedValue([]),
  getNodesByNotePath: vi.fn(),
  searchSummaryEmbeddings: vi.fn(),
  searchContentEmbeddings: vi.fn(),
  upsertSummary: vi.fn(),
  getSummary: vi.fn().mockResolvedValue(null),
  upsertEmbedding: vi.fn(),
  upsertTags: vi.fn(),
  upsertCrossReferences: vi.fn(),
  getCrossReferences: vi.fn()
});

const createDeps = (overrides?: Partial<ContextAssemblyServiceDeps>): ContextAssemblyServiceDeps => ({
  hierarchicalStore: createMockStore(),
  getSettings: () => createSettings(),
  ...overrides
});

const createLeafMatch = (overrides?: Partial<LeafMatch>): LeafMatch => ({
  node: createNode({
    nodeId: "para-1",
    nodeType: "paragraph",
    depth: 2,
    parentId: "topic-1",
    content: "Matched paragraph content.",
    headingTrail: ["Topic A"]
  }),
  score: 0.9,
  ancestorChain: [
    createNode({ nodeId: "topic-1", nodeType: "topic", depth: 1, headingTrail: ["Topic A"] }),
    createNode({ nodeId: "note-1", nodeType: "note", depth: 0 })
  ],
  ...overrides
});

describe("ContextAssemblyService", () => {
  describe("Phase A: Service Structure", () => {
    it("A1 — implements RuntimeServiceLifecycle", async () => {
      const service = new ContextAssemblyService(createDeps());
      await service.init();
      await service.dispose();
    });

    it("A2 — accepts ContextAssemblyServiceDeps via constructor", () => {
      const deps = createDeps();
      const service = new ContextAssemblyService(deps);
      expect(service).toBeDefined();
    });
  });

  describe("Phase B: Context Assembly Logic", () => {
    it("B1 — collects heading trails from ancestor chains", async () => {
      const service = new ContextAssemblyService(createDeps());
      await service.init();

      const match = createLeafMatch();
      const result = await service.assemble([match]);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].headingTrail).toEqual(["Topic A"]);
    });

    it("B2 — collects sibling content", async () => {
      const store = createMockStore();
      const siblingNode = createNode({
        nodeId: "para-2",
        nodeType: "paragraph",
        depth: 2,
        parentId: "topic-1",
        content: "Sibling paragraph content."
      });
      (store.getSiblings as ReturnType<typeof vi.fn>).mockResolvedValue([
        createNode({
          nodeId: "para-1",
          nodeType: "paragraph",
          depth: 2,
          parentId: "topic-1",
          content: "Matched paragraph content."
        }),
        siblingNode
      ]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new ContextAssemblyService(deps);
      await service.init();

      const match = createLeafMatch();
      const result = await service.assemble([match]);

      expect(result.blocks[0].siblingContent).toContain("Sibling paragraph content.");
    });

    it("B3 — collects parent summaries", async () => {
      const store = createMockStore();
      const topicSummary: SummaryRecord = {
        nodeId: "topic-1",
        summary: "Topic summary text.",
        modelUsed: "gpt-4o-mini",
        promptVersion: "v1",
        generatedAt: 1000
      };
      (store.getSummary as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === "topic-1") return topicSummary;
        return null;
      });

      const deps = createDeps({ hierarchicalStore: store });
      const service = new ContextAssemblyService(deps);
      await service.init();

      const match = createLeafMatch();
      const result = await service.assemble([match]);

      expect(result.blocks[0].parentSummary).toContain("Topic summary text.");
    });

    it("B4 — applies matched content token budget", async () => {
      const service = new ContextAssemblyService(createDeps());
      await service.init();

      const longContent = "A".repeat(DEFAULT_MATCHED_CONTENT_BUDGET * 4 + 1000);
      const match = createLeafMatch({
        node: createNode({
          nodeId: "para-1",
          nodeType: "paragraph",
          depth: 2,
          content: longContent,
          headingTrail: ["Topic A"]
        })
      });

      const result = await service.assemble([match]);

      const matchedTokens = result.tierUsage.matchedContentTokens;
      expect(matchedTokens).toBeLessThanOrEqual(DEFAULT_MATCHED_CONTENT_BUDGET);
    });

    it("B5 — applies sibling context token budget", async () => {
      const store = createMockStore();
      const longSiblingContent = "B".repeat(DEFAULT_SIBLING_CONTEXT_BUDGET * 4 + 1000);
      (store.getSiblings as ReturnType<typeof vi.fn>).mockResolvedValue([
        createNode({ nodeId: "para-1", nodeType: "paragraph", depth: 2, content: "Matched." }),
        createNode({ nodeId: "para-2", nodeType: "paragraph", depth: 2, content: longSiblingContent })
      ]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new ContextAssemblyService(deps);
      await service.init();

      const match = createLeafMatch();
      const result = await service.assemble([match]);

      expect(result.tierUsage.siblingContextTokens).toBeLessThanOrEqual(DEFAULT_SIBLING_CONTEXT_BUDGET);
    });

    it("B6 — applies parent summary token budget", async () => {
      const store = createMockStore();
      const longSummary = "C".repeat(DEFAULT_PARENT_SUMMARY_BUDGET * 4 + 1000);
      (store.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
        nodeId: "topic-1",
        summary: longSummary,
        modelUsed: "gpt-4o-mini",
        promptVersion: "v1",
        generatedAt: 1000
      });

      const deps = createDeps({ hierarchicalStore: store });
      const service = new ContextAssemblyService(deps);
      await service.init();

      const match = createLeafMatch();
      const result = await service.assemble([match]);

      expect(result.tierUsage.parentSummaryTokens).toBeLessThanOrEqual(DEFAULT_PARENT_SUMMARY_BUDGET);
    });

    it("B7 — tracks actual token usage per tier", async () => {
      const store = createMockStore();
      (store.getSiblings as ReturnType<typeof vi.fn>).mockResolvedValue([
        createNode({ nodeId: "para-1", nodeType: "paragraph", depth: 2, content: "Matched." }),
        createNode({ nodeId: "para-2", nodeType: "paragraph", depth: 2, content: "Sibling text." })
      ]);
      (store.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
        nodeId: "topic-1",
        summary: "Parent summary.",
        modelUsed: "gpt-4o-mini",
        promptVersion: "v1",
        generatedAt: 1000
      });

      const deps = createDeps({ hierarchicalStore: store });
      const service = new ContextAssemblyService(deps);
      await service.init();

      const match = createLeafMatch();
      const result = await service.assemble([match]);

      expect(result.tierUsage.matchedContentTokens).toBeGreaterThan(0);
      expect(result.tierUsage.siblingContextTokens).toBeGreaterThan(0);
      expect(result.tierUsage.parentSummaryTokens).toBeGreaterThan(0);
    });
  });

  describe("Phase C: Edge Cases", () => {
    it("C1 — empty matches returns empty context", async () => {
      const service = new ContextAssemblyService(createDeps());
      await service.init();

      const result = await service.assemble([]);

      expect(result.blocks).toHaveLength(0);
      expect(result.tierUsage.matchedContentTokens).toBe(0);
      expect(result.tierUsage.siblingContextTokens).toBe(0);
      expect(result.tierUsage.parentSummaryTokens).toBe(0);
    });

    it("C2 — disposed service throws", async () => {
      const service = new ContextAssemblyService(createDeps());
      await service.init();
      await service.dispose();

      await expect(service.assemble([])).rejects.toThrow("ContextAssemblyService is disposed.");
    });
  });

  describe("Phase D: Structured Logging", () => {
    it("D1 — emits retrieval.phase3.completed event", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const service = new ContextAssemblyService(createDeps());
      await service.init();

      const match = createLeafMatch();
      await service.assemble([match]);

      const phase3Event = infoSpy.mock.calls.find(
        (call) =>
          call[0] &&
          typeof call[0] === "object" &&
          (call[0] as Record<string, unknown>).event === "retrieval.phase3.completed"
      );
      expect(phase3Event).toBeDefined();

      infoSpy.mockRestore();
    });

    it("D2 — emits context.assembly.budget_usage event", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const service = new ContextAssemblyService(createDeps());
      await service.init();

      const match = createLeafMatch();
      await service.assemble([match]);

      const budgetEvent = infoSpy.mock.calls.find(
        (call) =>
          call[0] &&
          typeof call[0] === "object" &&
          (call[0] as Record<string, unknown>).event === "context.assembly.budget_usage"
      );
      expect(budgetEvent).toBeDefined();
      const payload = budgetEvent![0] as Record<string, unknown>;
      const ctx = payload.context as Record<string, unknown>;
      expect(ctx.matchedContentBudget).toBe(DEFAULT_MATCHED_CONTENT_BUDGET);
      expect(ctx.siblingContextBudget).toBe(DEFAULT_SIBLING_CONTEXT_BUDGET);
      expect(ctx.parentSummaryBudget).toBe(DEFAULT_PARENT_SUMMARY_BUDGET);

      infoSpy.mockRestore();
    });
  });
});
