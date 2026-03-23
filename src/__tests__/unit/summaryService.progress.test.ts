import { describe, expect, it, vi } from "vitest";
import {
  SummaryService,
  SUMMARY_STAGE_LABEL,
  type SummaryServiceDeps,
  type SummaryProgressEvent
} from "../../services/SummaryService";
import type {
  ChatProvider,
  ChatStreamEvent,
  DocumentNode,
  DocumentTree,
  HierarchicalStoreContract,
  ObsidianAISettings,
  ProviderRegistryContract,
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

const createTree = (root: DocumentNode, children: DocumentNode[] = []): DocumentTree => {
  const nodes = new Map<string, DocumentNode>();
  nodes.set(root.nodeId, root);
  for (const child of children) {
    nodes.set(child.nodeId, child);
  }
  return { root, nodes };
};

const createMockChatProvider = (): ChatProvider => ({
  id: "mock",
  name: "Mock Chat",
  complete: (): AsyncIterable<ChatStreamEvent> => {
    const events: ChatStreamEvent[] = [
      { type: "token", text: "Summary." },
      { type: "done", finishReason: "stop" }
    ];
    return {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            if (index < events.length) {
              return { value: events[index++], done: false };
            }
            return { value: undefined as unknown as ChatStreamEvent, done: true };
          }
        };
      }
    };
  }
});

const createMockSettings = (): ObsidianAISettings => ({
  embeddingProvider: "openai",
  chatProvider: "mock",
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

const createMockStore = (): HierarchicalStoreContract => {
  const summaries = new Map<string, SummaryRecord>();
  return {
    upsertNodeTree: vi.fn(),
    deleteByNotePath: vi.fn(),
    getNode: vi.fn(),
    getChildren: vi.fn(async () => []),
    getAncestorChain: vi.fn(async () => []),
    getSiblings: vi.fn(),
    getNodesByNotePath: vi.fn(),
    searchSummaryEmbeddings: vi.fn(),
    searchContentEmbeddings: vi.fn(),
    upsertSummary: vi.fn(async (nodeId: string, summary: SummaryRecord) => {
      summaries.set(nodeId, summary);
    }),
    getSummary: vi.fn(async (nodeId: string) => summaries.get(nodeId) ?? null),
    upsertEmbedding: vi.fn(),
    upsertTags: vi.fn(),
    getNodesByTag: vi.fn().mockResolvedValue([]),
    upsertCrossReferences: vi.fn(),
    getCrossReferences: vi.fn()
  };
};

const createMockRegistry = (): ProviderRegistryContract => {
  const chatProvider = createMockChatProvider();
  return {
    init: vi.fn(),
    dispose: vi.fn(),
    getEmbeddingProviderId: () => "openai",
    getChatProviderId: () => "mock",
    registerEmbeddingProvider: vi.fn(),
    getEmbeddingProvider: vi.fn(),
    listEmbeddingProviders: () => [],
    registerChatProvider: vi.fn(),
    getChatProvider: () => chatProvider,
    listChatProviders: () => [chatProvider]
  };
};

const createDeps = (overrides?: Partial<SummaryServiceDeps>): SummaryServiceDeps => ({
  providerRegistry: overrides?.providerRegistry ?? createMockRegistry(),
  hierarchicalStore: overrides?.hierarchicalStore ?? createMockStore(),
  getSettings: overrides?.getSettings ?? createMockSettings
});

describe("SUM-3: Summary Generation Progress Events", () => {
  describe("Phase A: Progress Callback", () => {
    it("A1 — generateSummaries accepts optional SummaryGenerationOptions", async () => {
      const service = new SummaryService(createDeps());
      await service.init();

      const root = createNode({ nodeId: "root", nodeType: "note" });
      const tree = createTree(root);

      const resultWithout = await service.generateSummaries(tree);
      expect(resultWithout).toBeDefined();

      const resultWith = await service.generateSummaries(tree, {});
      expect(resultWith).toBeDefined();
    });

    it("A2 — onNodeProcessed callback is invoked after each node", async () => {
      const service = new SummaryService(createDeps());
      await service.init();

      const p1 = createNode({ nodeId: "p1", parentId: "root", nodeType: "paragraph", content: "Short.", depth: 1 });
      const p2 = createNode({ nodeId: "p2", parentId: "root", nodeType: "paragraph", content: "Also short.", depth: 1 });
      const root = createNode({ nodeId: "root", nodeType: "note", childIds: ["p1", "p2"], depth: 0 });
      const tree = createTree(root, [p1, p2]);

      const events: SummaryProgressEvent[] = [];
      await service.generateSummaries(tree, {
        onNodeProcessed: (event) => events.push(event)
      });

      expect(events.length).toBe(3);

      expect(events[0].completed).toBe(1);
      expect(events[0].total).toBe(3);

      expect(events[1].completed).toBe(2);
      expect(events[1].total).toBe(3);

      expect(events[2].completed).toBe(3);
      expect(events[2].total).toBe(3);

      const nodeTypes = events.map((e) => e.currentNodeType);
      expect(nodeTypes).toContain("paragraph");
      expect(nodeTypes).toContain("note");
    });

    it("A3 — progress callback errors are swallowed and logged", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const service = new SummaryService(createDeps());
      await service.init();

      const p1 = createNode({ nodeId: "p1", parentId: "root", nodeType: "paragraph", content: "Short.", depth: 1 });
      const root = createNode({ nodeId: "root", nodeType: "note", childIds: ["p1"], depth: 0 });
      const tree = createTree(root, [p1]);

      const results = await service.generateSummaries(tree, {
        onNodeProcessed: () => {
          throw new Error("Callback boom");
        }
      });

      expect(results.length).toBe(2);

      const warnCall = warnSpy.mock.calls.find(
        (call) => (call[0] as { event?: string })?.event === "summary.generate.progress_callback_failed"
      );
      expect(warnCall).toBeDefined();
      warnSpy.mockRestore();
    });

    it("A4 — no callback invocation when options are omitted", async () => {
      const service = new SummaryService(createDeps());
      await service.init();

      const root = createNode({ nodeId: "root", nodeType: "note" });
      const tree = createTree(root);

      const results = await service.generateSummaries(tree);
      expect(results).toBeDefined();
    });
  });

  describe("Phase B: Stage Label", () => {
    it("B1 — SUMMARY_STAGE_LABEL constant is exported", () => {
      expect(SUMMARY_STAGE_LABEL).toBe("Summarize");
    });
  });
});
