import { describe, expect, it, vi } from "vitest";
import {
  SummaryService,
  SUMMARY_PROMPT_VERSION,
  type SummaryServiceDeps
} from "../../services/SummaryService";
import type {
  ChatProvider,
  ChatStreamEvent,
  DocumentNode,
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

const createMockChatProvider = (responseText = "Mock summary."): ChatProvider => ({
  id: "mock",
  name: "Mock Chat",
  complete: (): AsyncIterable<ChatStreamEvent> => {
    const events: ChatStreamEvent[] = [
      { type: "token", text: responseText },
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

const createMockStore = (): HierarchicalStoreContract & {
  upsertedSummaries: Map<string, SummaryRecord>;
  storedNodes: Map<string, DocumentNode>;
  storedChildren: Map<string, DocumentNode[]>;
  ancestorChains: Map<string, DocumentNode[]>;
} => {
  const upsertedSummaries = new Map<string, SummaryRecord>();
  const storedNodes = new Map<string, DocumentNode>();
  const storedChildren = new Map<string, DocumentNode[]>();
  const ancestorChains = new Map<string, DocumentNode[]>();

  return {
    upsertedSummaries,
    storedNodes,
    storedChildren,
    ancestorChains,
    upsertNodeTree: vi.fn(),
    deleteByNotePath: vi.fn(),
    getNode: vi.fn(async (nodeId: string) => storedNodes.get(nodeId) ?? null),
    getChildren: vi.fn(async (nodeId: string) => storedChildren.get(nodeId) ?? []),
    getAncestorChain: vi.fn(async (nodeId: string) => ancestorChains.get(nodeId) ?? []),
    getSiblings: vi.fn(),
    getNodesByNotePath: vi.fn(),
    searchSummaryEmbeddings: vi.fn(),
    searchContentEmbeddings: vi.fn(),
    upsertSummary: vi.fn(async (nodeId: string, summary: SummaryRecord) => {
      upsertedSummaries.set(nodeId, summary);
    }),
    getSummary: vi.fn(async (nodeId: string) => upsertedSummaries.get(nodeId) ?? null),
    upsertEmbedding: vi.fn(),
    upsertTags: vi.fn(),
    getNodesByTag: vi.fn().mockResolvedValue([]),
    upsertCrossReferences: vi.fn(),
    getCrossReferences: vi.fn()
  };
};

const createMockRegistry = (provider?: ChatProvider): ProviderRegistryContract => {
  const chatProvider = provider ?? createMockChatProvider();
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

describe("SUM-2: Incremental Summary Propagation", () => {
  describe("Phase A: Staleness Detection", () => {
    it("A1 — identifies nodes with no summary as stale", async () => {
      const store = createMockStore();
      const node = createNode({ nodeId: "p1", nodeType: "paragraph", updatedAt: 2000 });
      store.storedNodes.set("p1", node);

      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      const stale = await service.detectStaleSummaries([node]);
      expect(stale).toHaveLength(1);
      expect(stale[0].nodeId).toBe("p1");
      expect(stale[0].summaryGeneratedAt).toBeNull();
    });

    it("A2 — identifies nodes where generatedAt < updatedAt as stale", async () => {
      const store = createMockStore();
      const node = createNode({ nodeId: "p1", nodeType: "paragraph", updatedAt: 2000 });
      store.storedNodes.set("p1", node);
      store.upsertedSummaries.set("p1", {
        nodeId: "p1",
        summary: "Old summary.",
        modelUsed: "gpt-4o-mini",
        promptVersion: SUMMARY_PROMPT_VERSION,
        generatedAt: 1000
      });

      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      const stale = await service.detectStaleSummaries([node]);
      expect(stale).toHaveLength(1);
      expect(stale[0].summaryGeneratedAt).toBe(1000);
      expect(stale[0].nodeUpdatedAt).toBe(2000);
    });

    it("A3 — excludes nodes with fresh summaries", async () => {
      const store = createMockStore();
      const node = createNode({ nodeId: "p1", nodeType: "paragraph", updatedAt: 1000 });
      store.storedNodes.set("p1", node);
      store.upsertedSummaries.set("p1", {
        nodeId: "p1",
        summary: "Fresh summary.",
        modelUsed: "gpt-4o-mini",
        promptVersion: SUMMARY_PROMPT_VERSION,
        generatedAt: 2000
      });

      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      const stale = await service.detectStaleSummaries([node]);
      expect(stale).toHaveLength(0);
    });
  });

  describe("Phase B: Incremental Propagation", () => {
    it("B1 — propagates from single changed node to root", async () => {
      const store = createMockStore();

      const paragraph = createNode({ nodeId: "p1", parentId: "topic1", nodeType: "paragraph", content: "Short.", depth: 2 });
      const topic = createNode({ nodeId: "topic1", parentId: "root", nodeType: "topic", childIds: ["p1"], depth: 1 });
      const root = createNode({ nodeId: "root", nodeType: "note", childIds: ["topic1"], depth: 0 });

      store.storedNodes.set("p1", paragraph);
      store.storedNodes.set("topic1", topic);
      store.storedNodes.set("root", root);
      store.storedChildren.set("topic1", [paragraph]);
      store.storedChildren.set("root", [topic]);
      store.ancestorChains.set("p1", [topic, root]);

      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      const results = await service.propagateSummariesForChangedNodes(["p1"]);

      const nodeIds = results.map((r) => r.nodeId);
      expect(nodeIds).toContain("p1");
      expect(nodeIds).toContain("topic1");
      expect(nodeIds).toContain("root");
      expect(results).toHaveLength(3);
    });

    it("B2 — deduplicates shared ancestors when multiple nodes change", async () => {
      const store = createMockStore();

      const p1 = createNode({ nodeId: "p1", parentId: "topic1", nodeType: "paragraph", content: "Short.", depth: 2 });
      const p2 = createNode({ nodeId: "p2", parentId: "topic1", nodeType: "paragraph", content: "Also short.", depth: 2 });
      const topic = createNode({ nodeId: "topic1", parentId: "root", nodeType: "topic", childIds: ["p1", "p2"], depth: 1 });
      const root = createNode({ nodeId: "root", nodeType: "note", childIds: ["topic1"], depth: 0 });

      store.storedNodes.set("p1", p1);
      store.storedNodes.set("p2", p2);
      store.storedNodes.set("topic1", topic);
      store.storedNodes.set("root", root);
      store.storedChildren.set("topic1", [p1, p2]);
      store.storedChildren.set("root", [topic]);
      store.ancestorChains.set("p1", [topic, root]);
      store.ancestorChains.set("p2", [topic, root]);

      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      const results = await service.propagateSummariesForChangedNodes(["p1", "p2"]);

      const nodeIds = results.map((r) => r.nodeId);
      expect(nodeIds).toContain("p1");
      expect(nodeIds).toContain("p2");
      expect(nodeIds).toContain("topic1");
      expect(nodeIds).toContain("root");
      expect(results).toHaveLength(4);
    });

    it("B3 — empty changed node list returns empty results", async () => {
      const service = new SummaryService(createDeps());
      await service.init();

      const results = await service.propagateSummariesForChangedNodes([]);
      expect(results).toHaveLength(0);
    });

    it("B4 — non-existent node IDs are gracefully skipped", async () => {
      const store = createMockStore();
      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      const results = await service.propagateSummariesForChangedNodes(["nonexistent"]);
      expect(results).toHaveLength(0);
    });
  });

  describe("Phase C: Structured Logging", () => {
    it("C1 — incremental propagation emits start and completion events", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const store = createMockStore();
      const node = createNode({ nodeId: "p1", nodeType: "paragraph", content: "Short.", depth: 1 });
      store.storedNodes.set("p1", node);
      store.ancestorChains.set("p1", []);

      const service = new SummaryService(createDeps({ hierarchicalStore: store }));
      await service.init();

      await service.propagateSummariesForChangedNodes(["p1"]);

      const startedCall = consoleSpy.mock.calls.find(
        (call) => (call[0] as { event?: string })?.event === "summary.propagate.started"
      );
      const completedCall = consoleSpy.mock.calls.find(
        (call) => (call[0] as { event?: string })?.event === "summary.propagate.completed"
      );
      expect(startedCall).toBeDefined();
      expect(completedCall).toBeDefined();
      consoleSpy.mockRestore();
    });
  });
});
