import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, snapshotSettings } from "../../settings";
import type { ObsidianAISettings } from "../../types";
import {
  ContextAssemblyService,
  type ContextAssemblyServiceDeps
} from "../../services/ContextAssemblyService";
import {
  SummaryService,
  type SummaryServiceDeps
} from "../../services/SummaryService";
import type {
  ChatProvider,
  ChatStreamEvent,
  DocumentNode,
  DocumentTree,
  HierarchicalStoreContract,
  ProviderRegistryContract
} from "../../types";

const createFullSettings = (overrides?: Partial<ObsidianAISettings>): ObsidianAISettings => ({
  ...DEFAULT_SETTINGS,
  ...overrides
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

function* streamTokens(text: string): Generator<ChatStreamEvent> {
  yield { type: "token", text };
  yield { type: "done", finishReason: "stop" };
}

const createMockChatProvider = (responseText = "Summary."): ChatProvider => ({
  id: "openai",
  name: "OpenAI",
  complete: vi.fn().mockReturnValue(streamTokens(responseText))
});

const createMockProviderRegistry = (chatProvider: ChatProvider): ProviderRegistryContract => ({
  getEmbeddingProviderId: vi.fn().mockReturnValue("openai"),
  getChatProviderId: vi.fn().mockReturnValue("openai"),
  registerEmbeddingProvider: vi.fn(),
  getEmbeddingProvider: vi.fn(),
  listEmbeddingProviders: vi.fn().mockReturnValue([]),
  registerChatProvider: vi.fn(),
  getChatProvider: vi.fn().mockReturnValue(chatProvider),
  listChatProviders: vi.fn().mockReturnValue([chatProvider]),
  init: vi.fn(),
  dispose: vi.fn()
});

describe("Token Budget Settings", () => {
  describe("Phase A: Settings Schema", () => {
    it("A1_summaryMaxTokens_in_interface", () => {
      const settings: ObsidianAISettings = createFullSettings();
      const value: number = settings.summaryMaxTokens;
      expect(typeof value).toBe("number");
    });

    it("A2_matchedContentBudget_in_interface", () => {
      const settings: ObsidianAISettings = createFullSettings();
      const value: number = settings.matchedContentBudget;
      expect(typeof value).toBe("number");
    });

    it("A3_siblingContextBudget_in_interface", () => {
      const settings: ObsidianAISettings = createFullSettings();
      const value: number = settings.siblingContextBudget;
      expect(typeof value).toBe("number");
    });

    it("A4_parentSummaryBudget_in_interface", () => {
      const settings: ObsidianAISettings = createFullSettings();
      const value: number = settings.parentSummaryBudget;
      expect(typeof value).toBe("number");
    });
  });

  describe("Phase B: Default Values", () => {
    it("B1_default_summaryMaxTokens", () => {
      expect(DEFAULT_SETTINGS.summaryMaxTokens).toBe(100);
    });

    it("B2_default_matchedContentBudget", () => {
      expect(DEFAULT_SETTINGS.matchedContentBudget).toBe(2000);
    });

    it("B3_default_siblingContextBudget", () => {
      expect(DEFAULT_SETTINGS.siblingContextBudget).toBe(1000);
    });

    it("B4_default_parentSummaryBudget", () => {
      expect(DEFAULT_SETTINGS.parentSummaryBudget).toBe(1000);
    });
  });

  describe("Phase C: Settings Snapshot", () => {
    it("C1_snapshot_preserves_summaryMaxTokens", () => {
      const settings = createFullSettings({ summaryMaxTokens: 200 });
      const snapshot = snapshotSettings(settings);
      expect(snapshot.summaryMaxTokens).toBe(200);
    });

    it("C2_snapshot_preserves_matchedContentBudget", () => {
      const settings = createFullSettings({ matchedContentBudget: 3000 });
      const snapshot = snapshotSettings(settings);
      expect(snapshot.matchedContentBudget).toBe(3000);
    });

    it("C3_snapshot_preserves_siblingContextBudget", () => {
      const settings = createFullSettings({ siblingContextBudget: 1500 });
      const snapshot = snapshotSettings(settings);
      expect(snapshot.siblingContextBudget).toBe(1500);
    });

    it("C4_snapshot_preserves_parentSummaryBudget", () => {
      const settings = createFullSettings({ parentSummaryBudget: 1500 });
      const snapshot = snapshotSettings(settings);
      expect(snapshot.parentSummaryBudget).toBe(1500);
    });
  });

  describe("Phase D: Service Integration", () => {
    it("D1_context_assembly_reads_typed_settings", async () => {
      const customSettings = createFullSettings({
        matchedContentBudget: 500,
        siblingContextBudget: 300,
        parentSummaryBudget: 200
      });

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

      const deps: ContextAssemblyServiceDeps = {
        hierarchicalStore: store,
        getSettings: () => customSettings
      };

      const service = new ContextAssemblyService(deps);
      await service.init();

      const match = {
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
        ]
      };

      const result = await service.assemble([match]);
      expect(result.blocks).toHaveLength(1);
      expect(result.tierUsage.matchedContentTokens).toBeGreaterThan(0);
      expect(result.tierUsage.matchedContentTokens).toBeLessThanOrEqual(500);
    });

    it("D2_summary_service_reads_settings", async () => {
      const longResponse = "A ".repeat(200);
      const chatProvider = createMockChatProvider(longResponse);
      const registry = createMockProviderRegistry(chatProvider);
      const store = createMockStore();

      const customSettings = createFullSettings({ summaryMaxTokens: 50 });

      const deps: SummaryServiceDeps = {
        providerRegistry: registry,
        hierarchicalStore: store,
        getSettings: () => customSettings
      };

      const service = new SummaryService(deps);
      await service.init();

      const leafNode = createNode({
        nodeId: "para-1",
        nodeType: "paragraph",
        depth: 2,
        content: "A ".repeat(500)
      });

      const tree: DocumentTree = {
        root: createNode({ nodeId: "note-1", nodeType: "note", depth: 0, childIds: ["para-1"] }),
        nodes: new Map([
          ["note-1", createNode({ nodeId: "note-1", nodeType: "note", depth: 0, childIds: ["para-1"] })],
          ["para-1", leafNode]
        ])
      };

      const results = await service.generateSummaries(tree);
      const paraResult = results.find((r) => r.nodeId === "para-1");
      expect(paraResult).toBeDefined();
      expect(paraResult!.skipped).toBe(false);

      const storedCall = (store.upsertSummary as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => call[0] === "para-1"
      );
      expect(storedCall).toBeDefined();
    });
  });
});
