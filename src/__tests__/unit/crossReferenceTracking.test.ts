import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildDocumentTree } from "../../utils/chunker";
import { ContextAssemblyService } from "../../services/ContextAssemblyService";
import type {
  ChunkerInput,
  CrossReference,
  DocumentNode,
  HierarchicalStoreContract,
  LeafMatch,
  ObsidianAISettings,
  SummaryRecord
} from "../../types";
import { DEFAULT_SETTINGS } from "../../settings";

const buildInput = (markdown: string, notePath = "test.md", noteTitle = "Test"): ChunkerInput => ({
  notePath,
  noteTitle,
  markdown,
  updatedAt: Date.now()
});

describe("META-2: Cross-Reference Tracking", () => {
  describe("A: Cross-reference storage verification", () => {
    it("A1_cross_refs_stored_and_retrievable — wikilinks extracted and returned by getCrossReferences", () => {
      const markdown = `# Topic\n\nSee [[other-note]] for details.\n`;
      const input = buildInput(markdown, "source.md", "Source");
      const result = buildDocumentTree(input);

      expect(result.crossReferences.length).toBeGreaterThan(0);
      const ref = result.crossReferences.find((r) => r.targetPath === "other-note");
      expect(ref).toBeDefined();
      expect(ref!.targetDisplay).toBeNull();
    });

    it("A2_cross_refs_include_display — [[target|display]] syntax preserves display text", () => {
      const markdown = `# Topic\n\nSee [[other-note|Other Note Title]] for details.\n`;
      const input = buildInput(markdown, "source.md", "Source");
      const result = buildDocumentTree(input);

      const ref = result.crossReferences.find((r) => r.targetPath === "other-note");
      expect(ref).toBeDefined();
      expect(ref!.targetDisplay).toBe("Other Note Title");
    });

    it("A3_code_fence_exclusion — wikilinks inside code fences are not extracted", () => {
      const markdown = `# Topic\n\n\`\`\`\n[[should-not-extract]]\n\`\`\`\n\nSee [[should-extract]] here.\n`;
      const input = buildInput(markdown, "source.md", "Source");
      const result = buildDocumentTree(input);

      const excluded = result.crossReferences.find((r) => r.targetPath === "should-not-extract");
      expect(excluded).toBeUndefined();

      const included = result.crossReferences.find((r) => r.targetPath === "should-extract");
      expect(included).toBeDefined();
    });
  });

  describe("B: Context expansion via cross-references", () => {
    const createMockStore = (overrides: Partial<HierarchicalStoreContract> = {}): HierarchicalStoreContract => ({
      upsertNodeTree: vi.fn().mockResolvedValue(undefined),
      deleteByNotePath: vi.fn().mockResolvedValue(undefined),
      getNode: vi.fn().mockResolvedValue(null),
      getChildren: vi.fn().mockResolvedValue([]),
      getAncestorChain: vi.fn().mockResolvedValue([]),
      getSiblings: vi.fn().mockResolvedValue([]),
      getNodesByNotePath: vi.fn().mockResolvedValue([]),
      searchSummaryEmbeddings: vi.fn().mockResolvedValue([]),
      searchContentEmbeddings: vi.fn().mockResolvedValue([]),
      upsertSummary: vi.fn().mockResolvedValue(undefined),
      getSummary: vi.fn().mockResolvedValue(null),
      upsertEmbedding: vi.fn().mockResolvedValue(undefined),
      upsertTags: vi.fn().mockResolvedValue(undefined),
      getNodesByTag: vi.fn().mockResolvedValue([]),
      upsertCrossReferences: vi.fn().mockResolvedValue(undefined),
      getCrossReferences: vi.fn().mockResolvedValue([]),
      ...overrides
    });

    const createLeafMatch = (
      nodeId: string,
      notePath: string,
      content: string,
      score = 0.9
    ): LeafMatch => ({
      node: {
        nodeId,
        parentId: `parent-${nodeId}`,
        childIds: [],
        notePath,
        noteTitle: notePath.replace(".md", ""),
        headingTrail: ["Topic"],
        depth: 2,
        nodeType: "paragraph",
        content,
        sequenceIndex: 0,
        tags: [],
        contentHash: "hash",
        updatedAt: Date.now()
      },
      score,
      ancestorChain: []
    });

    const targetRootNode: DocumentNode = {
      nodeId: "target-root",
      parentId: null,
      childIds: ["target-child"],
      notePath: "target-note.md",
      noteTitle: "Target Note",
      headingTrail: [],
      depth: 0,
      nodeType: "note",
      content: "Target Note",
      sequenceIndex: 0,
      tags: [],
      contentHash: "hash",
      updatedAt: Date.now()
    };

    const targetSummary: SummaryRecord = {
      nodeId: "target-root",
      summary: "This is the target note summary about important topics.",
      modelUsed: "test-model",
      promptVersion: "v1",
      generatedAt: Date.now()
    };

    const crossRef: CrossReference = {
      sourceNodeId: "leaf-1",
      targetPath: "target-note.md",
      targetDisplay: null
    };

    let settings: ObsidianAISettings;

    beforeEach(() => {
      settings = { ...DEFAULT_SETTINGS };
    });

    it("B1_cross_ref_expansion — follows cross-references and includes target note summaries", async () => {
      const store = createMockStore({
        getCrossReferences: vi.fn().mockImplementation(async (nodeId: string) => {
          if (nodeId === "leaf-1") return [crossRef];
          return [];
        }),
        getNodesByNotePath: vi.fn().mockImplementation(async (path: string) => {
          if (path === "target-note.md") return [targetRootNode];
          return [];
        }),
        getSummary: vi.fn().mockImplementation(async (nodeId: string) => {
          if (nodeId === "target-root") return targetSummary;
          return null;
        }),
        getSiblings: vi.fn().mockResolvedValue([])
      });

      const service = new ContextAssemblyService({
        hierarchicalStore: store,
        getSettings: () => settings
      });
      await service.init();

      const match = createLeafMatch("leaf-1", "source.md", "Source content");
      const result = await service.assemble([match]);

      const crossRefBlock = result.blocks.find((b) => b.notePath === "target-note.md");
      expect(crossRefBlock).toBeDefined();
      expect(crossRefBlock!.parentSummary).toContain("target note summary");
      expect(crossRefBlock!.matchedContent).toBe("");
      expect(crossRefBlock!.score).toBe(0);
    });

    it("B2_budget_enforcement — cross-ref expansion charges against parent summary budget", async () => {
      settings.parentSummaryBudget = 5;

      const store = createMockStore({
        getCrossReferences: vi.fn().mockImplementation(async (nodeId: string) => {
          if (nodeId === "leaf-1") return [crossRef];
          return [];
        }),
        getNodesByNotePath: vi.fn().mockImplementation(async (path: string) => {
          if (path === "target-note.md") return [targetRootNode];
          return [];
        }),
        getSummary: vi.fn().mockImplementation(async (nodeId: string) => {
          if (nodeId === "target-root") return targetSummary;
          return null;
        }),
        getSiblings: vi.fn().mockResolvedValue([])
      });

      const service = new ContextAssemblyService({
        hierarchicalStore: store,
        getSettings: () => settings
      });
      await service.init();

      const match = createLeafMatch("leaf-1", "source.md", "Source content");
      const result = await service.assemble([match]);

      expect(result.tierUsage.parentSummaryTokens).toBeGreaterThan(0);
    });

    it("B3_deduplication — same target referenced by multiple nodes produces only one expansion block", async () => {
      const store = createMockStore({
        getCrossReferences: vi.fn().mockImplementation(async () => [crossRef]),
        getNodesByNotePath: vi.fn().mockImplementation(async (path: string) => {
          if (path === "target-note.md") return [targetRootNode];
          return [];
        }),
        getSummary: vi.fn().mockImplementation(async (nodeId: string) => {
          if (nodeId === "target-root") return targetSummary;
          return null;
        }),
        getSiblings: vi.fn().mockResolvedValue([])
      });

      const service = new ContextAssemblyService({
        hierarchicalStore: store,
        getSettings: () => settings
      });
      await service.init();

      const match1 = createLeafMatch("leaf-1", "source.md", "Content 1");
      const match2 = createLeafMatch("leaf-2", "source.md", "Content 2");
      const result = await service.assemble([match1, match2]);

      const crossRefBlocks = result.blocks.filter((b) => b.notePath === "target-note.md");
      expect(crossRefBlocks.length).toBe(1);
    });

    it("B4_missing_target — gracefully handles target notes not in the index", async () => {
      const missingRef: CrossReference = {
        sourceNodeId: "leaf-1",
        targetPath: "nonexistent.md",
        targetDisplay: null
      };

      const store = createMockStore({
        getCrossReferences: vi.fn().mockResolvedValue([missingRef]),
        getNodesByNotePath: vi.fn().mockResolvedValue([]),
        getSiblings: vi.fn().mockResolvedValue([])
      });

      const service = new ContextAssemblyService({
        hierarchicalStore: store,
        getSettings: () => settings
      });
      await service.init();

      const match = createLeafMatch("leaf-1", "source.md", "Source content");
      const result = await service.assemble([match]);

      const crossRefBlocks = result.blocks.filter((b) => b.notePath === "nonexistent.md");
      expect(crossRefBlocks.length).toBe(0);
    });

    it("B5_no_cross_refs — when no cross-references exist, assembly is unchanged", async () => {
      const store = createMockStore({
        getCrossReferences: vi.fn().mockResolvedValue([]),
        getSiblings: vi.fn().mockResolvedValue([])
      });

      const service = new ContextAssemblyService({
        hierarchicalStore: store,
        getSettings: () => settings
      });
      await service.init();

      const match = createLeafMatch("leaf-1", "source.md", "Source content");
      const result = await service.assemble([match]);

      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].notePath).toBe("source.md");
    });
  });
});
