import { describe, expect, it, vi } from "vitest";
import {
  SummaryService,
  SUMMARY_PROMPT_VERSION,
  SHORT_LEAF_TOKEN_THRESHOLD,
  type SummaryServiceDeps
} from "../../services/SummaryService";
import type {
  ChatProvider,
  ChatRequest,
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

const shortContent = "Short paragraph content.";
const longContent = "A".repeat(SHORT_LEAF_TOKEN_THRESHOLD * 4 + 100);

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

const createFailingChatProvider = (errorMessage: string): ChatProvider => ({
  id: "mock",
  name: "Mock Chat",
  complete: (): AsyncIterable<ChatStreamEvent> => {
    const events: ChatStreamEvent[] = [
      { type: "error", message: errorMessage, retryable: false }
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
  logLevel: "info"
});

const createMockStore = (): HierarchicalStoreContract & {
  upsertedSummaries: Map<string, SummaryRecord>;
  storedNodes: Map<string, DocumentNode>;
  storedChildren: Map<string, DocumentNode[]>;
} => {
  const upsertedSummaries = new Map<string, SummaryRecord>();
  const storedNodes = new Map<string, DocumentNode>();
  const storedChildren = new Map<string, DocumentNode[]>();

  return {
    upsertedSummaries,
    storedNodes,
    storedChildren,
    upsertNodeTree: vi.fn(),
    deleteByNotePath: vi.fn(),
    getNode: vi.fn(async (nodeId: string) => storedNodes.get(nodeId) ?? null),
    getChildren: vi.fn(async (nodeId: string) => storedChildren.get(nodeId) ?? []),
    getAncestorChain: vi.fn(async () => []),
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

describe("SUM-1: SummaryService", () => {
  describe("Phase A: Service Structure and Lifecycle", () => {
    it("A1 — lifecycle init and dispose", async () => {
      const service = new SummaryService(createDeps());
      await service.init();

      const root = createNode({ nodeId: "root", nodeType: "note" });
      const tree = createTree(root);
      await expect(service.generateSummaries(tree)).resolves.toBeDefined();

      await service.dispose();
      await expect(service.generateSummaries(tree)).rejects.toThrow("SummaryService is disposed.");
    });

    it("A2 — constructor accepts SummaryServiceDeps", () => {
      const deps = createDeps();
      const service = new SummaryService(deps);
      expect(service).toBeDefined();
    });
  });

  describe("Phase B: Bottom-Up Tree Traversal", () => {
    it("B1 — processes leaf nodes before their parents", async () => {
      const processOrder: string[] = [];
      const mockProvider = createMockChatProvider("Summary text.");
      const originalComplete = mockProvider.complete.bind(mockProvider);
      mockProvider.complete = (request: ChatRequest) => {
        const userMsg = request.messages.find((m) => m.role === "user")?.content ?? "";
        if (userMsg.includes(longContent)) {
          processOrder.push("leaf");
        } else {
          processOrder.push("parent");
        }
        return originalComplete(request);
      };

      const store = createMockStore();
      const deps = createDeps({
        providerRegistry: createMockRegistry(mockProvider),
        hierarchicalStore: store
      });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "topic1",
        nodeType: "paragraph",
        content: longContent,
        depth: 2
      });
      const topic = createNode({
        nodeId: "topic1",
        parentId: "root",
        nodeType: "topic",
        childIds: ["p1"],
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["topic1"],
        depth: 0
      });
      const tree = createTree(root, [topic, paragraph]);

      await service.generateSummaries(tree);

      expect(processOrder[0]).toBe("leaf");
      expect(processOrder.length).toBeGreaterThanOrEqual(2);
    });

    it("B2 — short leaf nodes are skipped with content as summary", async () => {
      const store = createMockStore();
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: shortContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      const results = await service.generateSummaries(tree);
      const leafResult = results.find((r) => r.nodeId === "p1");

      expect(leafResult?.skipped).toBe(true);
      const stored = store.upsertedSummaries.get("p1");
      expect(stored?.summary).toBe(shortContent);
      expect(stored?.modelUsed).toBe("content-passthrough");
    });

    it("B3 — long leaf nodes receive LLM-generated summaries", async () => {
      const store = createMockStore();
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: longContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      const results = await service.generateSummaries(tree);
      const leafResult = results.find((r) => r.nodeId === "p1");

      expect(leafResult?.skipped).toBe(false);
      const stored = store.upsertedSummaries.get("p1");
      expect(stored?.summary).toBe("Mock summary.");
      expect(stored?.modelUsed).toBe("gpt-4o-mini");
    });

    it("B4 — non-leaf nodes receive LLM summaries from child summaries", async () => {
      const capturedPrompts: string[] = [];
      const mockProvider: ChatProvider = {
        id: "mock",
        name: "Mock",
        complete: (request: ChatRequest) => {
          const userMsg = request.messages.find((m) => m.role === "user")?.content ?? "";
          capturedPrompts.push(userMsg);
          return createMockChatProvider("Parent summary.").complete(request);
        }
      };

      const store = createMockStore();
      const deps = createDeps({
        providerRegistry: createMockRegistry(mockProvider),
        hierarchicalStore: store
      });
      const service = new SummaryService(deps);
      await service.init();

      const p1 = createNode({
        nodeId: "p1",
        parentId: "topic1",
        nodeType: "paragraph",
        content: shortContent,
        depth: 2
      });
      const topic = createNode({
        nodeId: "topic1",
        parentId: "root",
        nodeType: "topic",
        childIds: ["p1"],
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["topic1"],
        depth: 0
      });
      const tree = createTree(root, [topic, p1]);

      await service.generateSummaries(tree);

      const topicPrompt = capturedPrompts.find((p) => p.includes("topic"));
      expect(topicPrompt).toBeDefined();
      expect(topicPrompt).toContain(shortContent);
    });
  });

  describe("Phase C: LLM Integration", () => {
    it("C1 — uses the configured chat provider", async () => {
      const getChatProvider = vi.fn(() => createMockChatProvider());
      const registry = createMockRegistry();
      registry.getChatProvider = getChatProvider;

      const deps = createDeps({ providerRegistry: registry });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: longContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      await service.generateSummaries(tree);
      expect(getChatProvider).toHaveBeenCalled();
    });

    it("C2 — summary prompt instructs faithful representation", async () => {
      let capturedRequest: ChatRequest | null = null;
      const mockProvider: ChatProvider = {
        id: "mock",
        name: "Mock",
        complete: (request: ChatRequest) => {
          capturedRequest = request;
          return createMockChatProvider().complete(request);
        }
      };

      const deps = createDeps({ providerRegistry: createMockRegistry(mockProvider) });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: longContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      await service.generateSummaries(tree);

      expect(capturedRequest).not.toBeNull();
      const systemMsg = capturedRequest!.messages.find((m) => m.role === "system");
      expect(systemMsg?.content).toContain("concise");
      expect(systemMsg?.content).toContain("Preserve key terms");
      expect(systemMsg?.content).toContain("Do not editorialize");
    });

    it("C3 — collects tokens into complete summary string", async () => {
      const multiTokenProvider: ChatProvider = {
        id: "mock",
        name: "Mock",
        complete: (): AsyncIterable<ChatStreamEvent> => {
          const events: ChatStreamEvent[] = [
            { type: "token", text: "Hello " },
            { type: "token", text: "world." },
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
      };

      const store = createMockStore();
      const deps = createDeps({
        providerRegistry: createMockRegistry(multiTokenProvider),
        hierarchicalStore: store
      });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: longContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      await service.generateSummaries(tree);

      const stored = store.upsertedSummaries.get("p1");
      expect(stored?.summary).toBe("Hello world.");
    });
  });

  describe("Phase D: Summary Persistence", () => {
    it("D1 — stores summaries with provenance metadata", async () => {
      const store = createMockStore();
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: longContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      await service.generateSummaries(tree);

      const stored = store.upsertedSummaries.get("p1");
      expect(stored).toBeDefined();
      expect(stored!.nodeId).toBe("p1");
      expect(stored!.modelUsed).toBe("gpt-4o-mini");
      expect(stored!.promptVersion).toBe(SUMMARY_PROMPT_VERSION);
      expect(stored!.generatedAt).toBeGreaterThan(0);
    });

    it("D2 — skipped leaf nodes have content stored as summary", async () => {
      const store = createMockStore();
      const deps = createDeps({ hierarchicalStore: store });
      const service = new SummaryService(deps);
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: shortContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      await service.generateSummaries(tree);

      const stored = store.upsertedSummaries.get("p1");
      expect(stored).toBeDefined();
      expect(stored!.summary).toBe(shortContent);
      expect(stored!.modelUsed).toBe("content-passthrough");
      expect(stored!.promptVersion).toBe(SUMMARY_PROMPT_VERSION);
    });
  });

  describe("Phase E: Error Handling", () => {
    it("E1 — individual node summary failures are logged and skipped", async () => {
      const store = createMockStore();
      const deps = createDeps({
        providerRegistry: createMockRegistry(createFailingChatProvider("LLM error")),
        hierarchicalStore: store
      });
      const service = new SummaryService(deps);
      await service.init();

      const p1 = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: longContent,
        depth: 1
      });
      const p2 = createNode({
        nodeId: "p2",
        parentId: "root",
        nodeType: "paragraph",
        content: shortContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1", "p2"],
        depth: 0
      });
      const tree = createTree(root, [p1, p2]);

      const results = await service.generateSummaries(tree);

      const failedResult = results.find((r) => r.nodeId === "p1");
      expect(failedResult?.error).toContain("LLM error");

      const successResult = results.find((r) => r.nodeId === "p2");
      expect(successResult?.skipped).toBe(true);
      expect(successResult?.error).toBeUndefined();
    });

    it("E2 — disposed service throws on generateSummaries", async () => {
      const service = new SummaryService(createDeps());
      await service.init();
      await service.dispose();

      const root = createNode({ nodeId: "root", nodeType: "note" });
      const tree = createTree(root);
      await expect(service.generateSummaries(tree)).rejects.toThrow("SummaryService is disposed.");
    });
  });

  describe("Phase F: Structured Logging", () => {
    it("F1 — emits summary.generate.started event", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const service = new SummaryService(createDeps());
      await service.init();

      const root = createNode({ nodeId: "root", nodeType: "note" });
      const tree = createTree(root);

      await service.generateSummaries(tree);

      const startedCall = consoleSpy.mock.calls.find(
        (call) => (call[0] as { event?: string })?.event === "summary.generate.started"
      );
      expect(startedCall).toBeDefined();
      consoleSpy.mockRestore();
    });

    it("F2 — emits per-node completed/skipped events", async () => {
      const { setRuntimeLogLevel } = await import("../../logging/runtimeLogger");
      setRuntimeLogLevel("debug");
      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const service = new SummaryService(createDeps());
      await service.init();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "root",
        nodeType: "paragraph",
        content: shortContent,
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["p1"],
        depth: 0
      });
      const tree = createTree(root, [paragraph]);

      await service.generateSummaries(tree);

      const skippedCall = consoleSpy.mock.calls.find(
        (call) => (call[0] as { event?: string })?.event === "summary.generate.skipped"
      );
      expect(skippedCall).toBeDefined();
      consoleSpy.mockRestore();
      setRuntimeLogLevel("info");
    });

    it("F3 — emits completion event with total counts", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const service = new SummaryService(createDeps());
      await service.init();

      const root = createNode({ nodeId: "root", nodeType: "note" });
      const tree = createTree(root);

      await service.generateSummaries(tree);

      const completedCall = consoleSpy.mock.calls.find(
        (call) => (call[0] as { event?: string })?.event === "summary.generate.completed"
      );
      expect(completedCall).toBeDefined();
      const payload = completedCall![0] as { context?: { totalNodes?: number } };
      expect(payload.context?.totalNodes).toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  describe("Phase G: regenerateFromNode", () => {
    it("G1 — regenerates from specified node up to root", async () => {
      const store = createMockStore();

      const paragraph = createNode({
        nodeId: "p1",
        parentId: "topic1",
        nodeType: "paragraph",
        content: shortContent,
        depth: 2
      });
      const topic = createNode({
        nodeId: "topic1",
        parentId: "root",
        nodeType: "topic",
        childIds: ["p1"],
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["topic1"],
        depth: 0
      });

      store.storedNodes.set("p1", paragraph);
      store.storedNodes.set("topic1", topic);
      store.storedNodes.set("root", root);
      store.storedChildren.set("topic1", [paragraph]);
      store.storedChildren.set("root", [topic]);

      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([topic, root]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SummaryService(deps);
      await service.init();

      const results = await service.regenerateFromNode("p1");

      expect(results.length).toBe(3);
      const nodeIds = results.map((r) => r.nodeId);
      expect(nodeIds).toContain("p1");
      expect(nodeIds).toContain("topic1");
      expect(nodeIds).toContain("root");
    });

    it("G2 — uses stored children summaries for ancestor nodes", async () => {
      const store = createMockStore();

      const p1 = createNode({
        nodeId: "p1",
        parentId: "topic1",
        nodeType: "paragraph",
        content: shortContent,
        depth: 2
      });
      const p2 = createNode({
        nodeId: "p2",
        parentId: "topic1",
        nodeType: "paragraph",
        content: "Other paragraph content.",
        depth: 2
      });
      const topic = createNode({
        nodeId: "topic1",
        parentId: "root",
        nodeType: "topic",
        childIds: ["p1", "p2"],
        depth: 1
      });
      const root = createNode({
        nodeId: "root",
        nodeType: "note",
        childIds: ["topic1"],
        depth: 0
      });

      store.storedNodes.set("p1", p1);
      store.storedNodes.set("p2", p2);
      store.storedNodes.set("topic1", topic);
      store.storedNodes.set("root", root);
      store.storedChildren.set("topic1", [p1, p2]);
      store.storedChildren.set("root", [topic]);

      store.upsertedSummaries.set("p2", {
        nodeId: "p2",
        summary: "Existing p2 summary.",
        modelUsed: "gpt-4o-mini",
        promptVersion: SUMMARY_PROMPT_VERSION,
        generatedAt: 1000
      });

      (store.getAncestorChain as ReturnType<typeof vi.fn>).mockResolvedValue([topic, root]);

      const deps = createDeps({ hierarchicalStore: store });
      const service = new SummaryService(deps);
      await service.init();

      await service.regenerateFromNode("p1");

      expect(store.getSummary).toHaveBeenCalled();
      const topicSummary = store.upsertedSummaries.get("topic1");
      expect(topicSummary).toBeDefined();
    });
  });
});
