import { describe, expect, it } from "vitest";
import { IndexingService } from "../../services/IndexingService";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import type {
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingType,
  EmbeddingVector,
  HierarchicalStoreContract,
  JobSnapshot,
  ObsidianAISettings,
  RuntimeBootstrapContext,
  SummaryRecord,
  SummaryServiceContract
} from "../../types";

interface MemoryPluginLike {
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
}

interface MockVaultFile {
  path: string;
  basename: string;
  markdown: string;
  mtime: number;
}

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

const createMemoryPlugin = (): MemoryPluginLike => {
  let data: unknown = null;
  return {
    loadData: async () => data,
    saveData: async (nextData) => {
      data = nextData;
    }
  };
};

const createMockApp = (files: MockVaultFile[]): RuntimeBootstrapContext["app"] => {
  const filesByPath = new Map<string, MockVaultFile>(files.map((f) => [f.path, f]));
  return {
    vault: {
      getMarkdownFiles: () =>
        files.map((f) => ({
          path: f.path,
          basename: f.basename,
          stat: { mtime: f.mtime }
        })),
      cachedRead: async (file: { path: string }) => filesByPath.get(file.path)?.markdown ?? ""
    }
  } as unknown as RuntimeBootstrapContext["app"];
};

const createEmbeddingResponse = (request: EmbeddingRequest): EmbeddingResponse => ({
  providerId: request.providerId,
  model: request.model,
  vectors: request.inputs.map(() => ({ values: [0.1, 0.2], dimensions: 2 }))
});

const createVectorStoreRepository = () => {
  const calls = {
    deleteByNotePaths: [] as string[][],
    upsertFromChunks: [] as Array<{ chunkCount: number }>,
    replaceAllFromChunks: [] as Array<{ chunkCount: number }>
  };
  return {
    repo: {
      getSchemaMetadata: async () => ({
        schemaVersion: 1,
        appliedMigrationIds: [],
        paths: {
          rootDir: ".obsidian/plugins/obsidian-ai-mvp/storage",
          sqliteDbPath: ".obsidian/plugins/obsidian-ai-mvp/storage/vector-store.sqlite3",
          migrationsDir: ".obsidian/plugins/obsidian-ai-mvp/storage/migrations"
        }
      }),
      replaceAllFromChunks: async (chunks: unknown[]) => {
        calls.replaceAllFromChunks.push({ chunkCount: chunks.length });
      },
      upsertFromChunks: async (chunks: unknown[]) => {
        calls.upsertFromChunks.push({ chunkCount: chunks.length });
      },
      deleteByNotePaths: async (paths: string[]) => {
        calls.deleteByNotePaths.push(paths);
      },
      queryNearestNeighbors: async () => []
    },
    calls
  };
};

interface HierarchicalStoreCalls {
  upsertNodeTree: DocumentTree[];
  upsertCrossReferences: CrossReference[][];
  upsertTags: Array<{ nodeId: string; tags: string[] }>;
  upsertEmbedding: Array<{ nodeId: string; embeddingType: EmbeddingType; vector: EmbeddingVector }>;
  getSummary: string[];
  deleteByNotePath: string[];
  getNodesByNotePath: string[];
}

const createMockHierarchicalStore = (opts: {
  summaryMap?: Map<string, SummaryRecord>;
  nodesByNotePath?: Map<string, DocumentNode[]>;
} = {}): { store: HierarchicalStoreContract; calls: HierarchicalStoreCalls } => {
  const summaryMap = opts.summaryMap ?? new Map();
  const nodesByNotePath = opts.nodesByNotePath ?? new Map();

  const calls: HierarchicalStoreCalls = {
    upsertNodeTree: [],
    upsertCrossReferences: [],
    upsertTags: [],
    upsertEmbedding: [],
    getSummary: [],
    deleteByNotePath: [],
    getNodesByNotePath: []
  };

  const store: HierarchicalStoreContract = {
    upsertNodeTree: async (tree: DocumentTree) => {
      calls.upsertNodeTree.push(tree);
    },
    deleteByNotePath: async (notePath: string) => {
      calls.deleteByNotePath.push(notePath);
    },
    getNode: async () => null,
    getChildren: async () => [],
    getAncestorChain: async () => [],
    getSiblings: async () => [],
    getNodesByNotePath: async (notePath: string) => {
      calls.getNodesByNotePath.push(notePath);
      return nodesByNotePath.get(notePath) ?? [];
    },
    searchSummaryEmbeddings: async () => [],
    searchContentEmbeddings: async () => [],
    upsertSummary: async () => undefined,
    getSummary: async (nodeId: string) => {
      calls.getSummary.push(nodeId);
      return summaryMap.get(nodeId) ?? null;
    },
    upsertEmbedding: async (nodeId: string, embeddingType: EmbeddingType, vector: EmbeddingVector) => {
      calls.upsertEmbedding.push({ nodeId, embeddingType, vector });
    },
    upsertTags: async (nodeId: string, tags: string[]) => {
      calls.upsertTags.push({ nodeId, tags });
    },
    getNodesByTag: async () => [],
    upsertCrossReferences: async (refs: CrossReference[]) => {
      calls.upsertCrossReferences.push(refs);
    },
    getCrossReferences: async () => []
  };

  return { store, calls };
};

interface SummaryServiceCalls {
  generateSummaries: DocumentTree[];
  propagateSummariesForChangedNodes: string[][];
}

const createMockSummaryService = (opts: {
  throwOnPropagate?: boolean;
} = {}): { service: SummaryServiceContract; calls: SummaryServiceCalls } => {
  const calls: SummaryServiceCalls = {
    generateSummaries: [],
    propagateSummariesForChangedNodes: []
  };

  const service: SummaryServiceContract = {
    init: async () => undefined,
    dispose: async () => undefined,
    generateSummaries: async (tree: DocumentTree) => {
      calls.generateSummaries.push(tree);
      return [];
    },
    regenerateFromNode: async () => [],
    detectStaleSummaries: async () => [],
    propagateSummariesForChangedNodes: async (changedNodeIds: string[]) => {
      if (opts.throwOnPropagate) {
        throw new Error("Summary propagation failed: LLM timeout");
      }
      calls.propagateSummariesForChangedNodes.push(changedNodeIds);
      return changedNodeIds.map((id) => ({ nodeId: id, skipped: false }));
    }
  };

  return { service, calls };
};

const BASELINE_FILES: MockVaultFile[] = [
  {
    path: "notes/alpha.md",
    basename: "alpha",
    markdown: "# Alpha\n\nFirst paragraph about alpha.\n\n- bullet one\n- bullet two",
    mtime: 100
  },
  {
    path: "notes/beta.md",
    basename: "beta",
    markdown: "# Beta\n\nSecond paragraph about beta.",
    mtime: 200
  }
];

/**
 * Creates a service + shared stores, runs a full reindex to establish a baseline manifest,
 * then returns a function to create a new service for incremental indexing that shares
 * the same manifest store, hierarchical store, summary service, and vector store.
 */
const setupBaselineAndIncrementalFactory = async (opts: {
  baselineFiles?: MockVaultFile[];
  summaryService?: SummaryServiceContract;
  hierarchicalStore?: HierarchicalStoreContract;
  vectorStoreRepo?: ReturnType<typeof createVectorStoreRepository>["repo"];
  embedFn?: (request: EmbeddingRequest) => Promise<EmbeddingResponse>;
}) => {
  const settings = createSettings();
  const plugin = createMemoryPlugin();
  const baselineFiles = opts.baselineFiles ?? BASELINE_FILES;
  const { service: defaultSummary } = createMockSummaryService();
  const { store: defaultStore } = createMockHierarchicalStore();
  const summaryService = opts.summaryService ?? defaultSummary;
  const hierarchicalStore = opts.hierarchicalStore ?? defaultStore;
  const vectorStoreRepo = opts.vectorStoreRepo ?? createVectorStoreRepository().repo;
  const embeddingRequests: EmbeddingRequest[] = [];
  const embedFn = opts.embedFn ?? (async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
    embeddingRequests.push(request);
    return createEmbeddingResponse(request);
  });

  const manifestStore = new IndexManifestStore({
    plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
  });
  const jobStateStore = new IndexJobStateStore({
    plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
  });

  const baselineService = new IndexingService({
    app: createMockApp(baselineFiles),
    embeddingService: { init: async () => undefined, dispose: async () => undefined, embed: embedFn },
    vectorStoreRepository: vectorStoreRepo,
    getSettings: () => settings,
    manifestStore,
    jobStateStore,
    summaryService,
    hierarchicalStore
  });

  await baselineService.init();
  await baselineService.reindexVault();

  const createIncrementalService = (incrementalFiles: MockVaultFile[], overrides?: {
    embedFn?: (request: EmbeddingRequest) => Promise<EmbeddingResponse>;
  }) => {
    const svc = new IndexingService({
      app: createMockApp(incrementalFiles),
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: overrides?.embedFn ?? embedFn
      },
      vectorStoreRepository: vectorStoreRepo,
      getSettings: () => settings,
      manifestStore,
      jobStateStore,
      summaryService,
      hierarchicalStore
    });
    return svc;
  };

  return { createIncrementalService, embeddingRequests };
};

const fakeDocumentNode = (overrides: Partial<DocumentNode> & { nodeId: string; notePath: string }): DocumentNode => ({
  parentId: null,
  childIds: [],
  noteTitle: "test",
  headingTrail: [],
  depth: 0,
  nodeType: "paragraph",
  content: "test content",
  sequenceIndex: 0,
  tags: [],
  contentHash: "abc123",
  updatedAt: Date.now(),
  ...overrides
});

describe("hierarchical incremental index pipeline", () => {
  describe("Phase A: Hierarchical Data Cleanup", () => {
    it("A1_collects_existing_node_ids — existing nodes are collected before deletion for updated notes", async () => {
      const existingNodes = [
        fakeDocumentNode({ nodeId: "old-node-1", notePath: "notes/alpha.md" }),
        fakeDocumentNode({ nodeId: "old-node-2", notePath: "notes/alpha.md" })
      ];
      const { store, calls: hierCalls } = createMockHierarchicalStore({
        nodesByNotePath: new Map([["notes/alpha.md", existingNodes]])
      });
      const { service: summaryService, calls: sumCalls } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.getNodesByNotePath.length = 0;
      hierCalls.deleteByNotePath.length = 0;
      sumCalls.propagateSummariesForChangedNodes.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated content.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.getNodesByNotePath).toContain("notes/alpha.md");

      expect(sumCalls.propagateSummariesForChangedNodes.length).toBe(1);
      const propagatedIds = sumCalls.propagateSummariesForChangedNodes[0];
      expect(propagatedIds).toContain("old-node-1");
      expect(propagatedIds).toContain("old-node-2");
    });

    it("A2_deletes_stale_hierarchical_data — deleteByNotePath called for updated and deleted notes", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.deleteByNotePath.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nChanged content.", mtime: 300 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.deleteByNotePath).toContain("notes/alpha.md");
      expect(hierCalls.deleteByNotePath).toContain("notes/beta.md");
    });

    it("A3_deleted_notes_no_tree_build — deleted notes have data cleaned but no tree built", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertNodeTree.length = 0;
      hierCalls.deleteByNotePath.length = 0;

      const svc = createIncrementalService([]);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.deleteByNotePath.length).toBeGreaterThan(0);
      expect(hierCalls.upsertNodeTree).toHaveLength(0);
    });
  });

  describe("Phase B: Tree Building and Node Storage", () => {
    it("B1_builds_trees_for_changed_notes — buildDocumentTree called for created/updated notes", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertNodeTree.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nNew alpha content.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 },
        { path: "notes/gamma.md", basename: "gamma", markdown: "# Gamma\n\nBrand new note.", mtime: 400 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      const storedPaths = hierCalls.upsertNodeTree.map((t) => t.root.notePath);
      expect(storedPaths).toContain("notes/alpha.md");
      expect(storedPaths).toContain("notes/gamma.md");
      expect(storedPaths).not.toContain("notes/beta.md");
    });

    it("B2_stores_node_trees — each tree is stored via upsertNodeTree", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertNodeTree.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.upsertNodeTree.length).toBeGreaterThan(0);
      for (const tree of hierCalls.upsertNodeTree) {
        expect(tree.root).toBeDefined();
        expect(tree.nodes.size).toBeGreaterThan(0);
      }
    });

    it("B3_stores_cross_references — cross-references stored for changed notes", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertCrossReferences.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated with [[beta]] link.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.upsertCrossReferences.length).toBeGreaterThan(0);
    });

    it("B4_stores_node_tags — tags stored for nodes with non-empty tags", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const baselineFiles: MockVaultFile[] = [
        { path: "notes/tagged.md", basename: "tagged", markdown: "---\ntags: [project]\n---\n# Tagged\n\nContent.", mtime: 100 }
      ];

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        baselineFiles,
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertTags.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/tagged.md", basename: "tagged", markdown: "---\ntags: [project, updated]\n---\n# Tagged\n\nNew content.", mtime: 300 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.upsertTags.length).toBeGreaterThan(0);
      for (const tagCall of hierCalls.upsertTags) {
        expect(tagCall.tags.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Phase C: Incremental Summary Propagation", () => {
    it("C1_propagates_summaries — propagateSummariesForChangedNodes called with collected node IDs", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService, calls: sumCalls } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      sumCalls.propagateSummariesForChangedNodes.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated alpha.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      expect(sumCalls.propagateSummariesForChangedNodes.length).toBe(1);
      const nodeIds = sumCalls.propagateSummariesForChangedNodes[0];
      expect(nodeIds.length).toBeGreaterThan(0);
    });

    it("C2_summary_propagation_error_non_fatal — propagation error does not abort pipeline", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService({ throwOnPropagate: true });

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated alpha.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      const snapshot = await svc.indexChanges();

      expect(snapshot.status).toBe("succeeded");
    });

    it("C3_no_changes_skips_propagation — no changes means no propagation call", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService, calls: sumCalls } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      sumCalls.propagateSummariesForChangedNodes.length = 0;

      const svc = createIncrementalService(BASELINE_FILES);
      await svc.init();
      await svc.indexChanges();

      expect(sumCalls.propagateSummariesForChangedNodes).toHaveLength(0);
    });
  });

  describe("Phase D: Hierarchical Embedding for Changed Nodes", () => {
    it("D1_embeds_leaf_content — leaf nodes embedded with type 'content'", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertEmbedding.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated alpha content.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      const contentEmbeddings = hierCalls.upsertEmbedding.filter((e) => e.embeddingType === "content");
      expect(contentEmbeddings.length).toBeGreaterThan(0);
      for (const emb of contentEmbeddings) {
        expect(emb.vector.values).toEqual([0.1, 0.2]);
      }
    });

    it("D2_embeds_non_leaf_summaries — non-leaf nodes with summaries embedded with type 'summary'", async () => {
      const summaryMap = new Map<string, SummaryRecord>();
      const { store, calls: hierCalls } = createMockHierarchicalStore({ summaryMap });

      const wrappedSummaryService: SummaryServiceContract = {
        init: async () => undefined,
        dispose: async () => undefined,
        generateSummaries: async (tree: DocumentTree) => {
          for (const node of tree.nodes.values()) {
            if (node.nodeType !== "paragraph" && node.nodeType !== "bullet") {
              summaryMap.set(node.nodeId, {
                nodeId: node.nodeId,
                summary: `Summary of ${node.nodeId}`,
                modelUsed: "gpt-4o-mini",
                promptVersion: "v1",
                generatedAt: Date.now()
              });
            }
          }
          return [];
        },
        regenerateFromNode: async () => [],
        detectStaleSummaries: async () => [],
        propagateSummariesForChangedNodes: async (ids: string[]) => {
          for (const id of ids) {
            if (!summaryMap.has(id)) {
              summaryMap.set(id, {
                nodeId: id,
                summary: `Propagated summary of ${id}`,
                modelUsed: "gpt-4o-mini",
                promptVersion: "v1",
                generatedAt: Date.now()
              });
            }
          }
          return ids.map((id) => ({ nodeId: id, skipped: false }));
        }
      };

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService: wrappedSummaryService,
        hierarchicalStore: store
      });

      hierCalls.upsertEmbedding.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated alpha.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      await svc.indexChanges();

      const summaryEmbeddings = hierCalls.upsertEmbedding.filter((e) => e.embeddingType === "summary");
      expect(summaryEmbeddings.length).toBeGreaterThan(0);
    });

    it("D3_embedding_error_recovery — embedding error includes recovery action", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      let embedCallCount = 0;
      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store,
        embedFn: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embedCallCount++;
          return createEmbeddingResponse(request);
        }
      });

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated alpha.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles, {
        embedFn: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embedCallCount++;
          if (embedCallCount > 100) {
            return createEmbeddingResponse(request);
          }
          throw new Error("Embedding provider timeout");
        }
      });
      await svc.init();

      try {
        await svc.indexChanges();
        expect.fail("Expected indexChanges to throw");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Recovery action:");
      }
    });
  });

  describe("Phase E: Progress Stages", () => {
    it("E1_progress_stage_order — stages follow Crawl → Chunk → Store → Summarize → Embed → Finalize", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();

      const snapshots: JobSnapshot[] = [];
      await svc.indexChanges({ onProgress: (s) => snapshots.push(s) });

      const labels = snapshots.map((s) => s.progress.label);
      const stageOrder = ["Crawl", "Chunk", "Store", "Summarize", "Embed", "Finalize"];
      for (const stage of stageOrder) {
        expect(labels.some((l) => l.includes(stage))).toBe(true);
      }
      const stageIndices = stageOrder.map((stage) =>
        labels.findIndex((l) => l.includes(stage))
      );
      for (let i = 1; i < stageIndices.length; i++) {
        expect(stageIndices[i]).toBeGreaterThan(stageIndices[i - 1]);
      }
    });

    it("E2_store_stage_detail — Store stage reports number of changed trees", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();

      const snapshots: JobSnapshot[] = [];
      await svc.indexChanges({ onProgress: (s) => snapshots.push(s) });

      const storeSnapshot = snapshots.find((s) => s.progress.label.includes("Store"));
      expect(storeSnapshot).toBeDefined();
      expect(storeSnapshot!.progress.detail).toContain("1");
      expect(storeSnapshot!.progress.detail).toContain("trees");
    });

    it("E3_summarize_stage_detail — Summarize stage reports propagation progress", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();

      const snapshots: JobSnapshot[] = [];
      await svc.indexChanges({ onProgress: (s) => snapshots.push(s) });

      const summarizeSnapshot = snapshots.find((s) => s.progress.label.includes("Summarize"));
      expect(summarizeSnapshot).toBeDefined();
      expect(summarizeSnapshot!.progress.detail).toContain("nodes");
    });

    it("E4_embed_stage_detail — Embed stage reports total nodes and flat chunks", async () => {
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();

      const snapshots: JobSnapshot[] = [];
      await svc.indexChanges({ onProgress: (s) => snapshots.push(s) });

      const embedSnapshot = snapshots.find((s) => s.progress.label.includes("Embed"));
      expect(embedSnapshot).toBeDefined();
      expect(embedSnapshot!.progress.detail).toContain("nodes");
    });
  });

  describe("Phase F: Flat Pipeline Preservation", () => {
    it("F1_flat_pipeline_preserved — flat pipeline still runs alongside hierarchical", async () => {
      const { repo: vectorRepo, calls: vectorCalls } = createVectorStoreRepository();
      const { store } = createMockHierarchicalStore();
      const { service: summaryService } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store,
        vectorStoreRepo: vectorRepo
      });

      vectorCalls.upsertFromChunks.length = 0;
      vectorCalls.deleteByNotePaths.length = 0;

      const updatedFiles: MockVaultFile[] = [
        { path: "notes/alpha.md", basename: "alpha", markdown: "# Alpha\n\nUpdated alpha.", mtime: 300 },
        { path: "notes/beta.md", basename: "beta", markdown: "# Beta\n\nSecond paragraph about beta.", mtime: 200 }
      ];

      const svc = createIncrementalService(updatedFiles);
      await svc.init();
      const snapshot = await svc.indexChanges();

      expect(snapshot.status).toBe("succeeded");
      expect(vectorCalls.deleteByNotePaths.length).toBeGreaterThan(0);
      expect(vectorCalls.upsertFromChunks.length).toBeGreaterThan(0);
      expect(vectorCalls.upsertFromChunks[0].chunkCount).toBeGreaterThan(0);
    });
  });

  describe("Phase G: Edge Cases", () => {
    it("G1_no_changes_no_hierarchical_calls — zero changes produces clean success with no hierarchical calls", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService, calls: sumCalls } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.deleteByNotePath.length = 0;
      hierCalls.upsertNodeTree.length = 0;
      hierCalls.upsertEmbedding.length = 0;
      hierCalls.getNodesByNotePath.length = 0;
      sumCalls.propagateSummariesForChangedNodes.length = 0;

      const svc = createIncrementalService(BASELINE_FILES);
      await svc.init();
      const snapshot = await svc.indexChanges();

      expect(snapshot.status).toBe("succeeded");
      expect(snapshot.progress.detail).toContain("No changes detected");
      expect(hierCalls.deleteByNotePath).toHaveLength(0);
      expect(hierCalls.upsertNodeTree).toHaveLength(0);
      expect(hierCalls.upsertEmbedding).toHaveLength(0);
      expect(hierCalls.getNodesByNotePath).toHaveLength(0);
      expect(sumCalls.propagateSummariesForChangedNodes).toHaveLength(0);
    });

    it("G2_only_deletes_cleanup_only — only deletions clean up hierarchical data without building trees", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService, calls: sumCalls } = createMockSummaryService();

      const { createIncrementalService } = await setupBaselineAndIncrementalFactory({
        summaryService,
        hierarchicalStore: store
      });

      hierCalls.deleteByNotePath.length = 0;
      hierCalls.upsertNodeTree.length = 0;
      sumCalls.propagateSummariesForChangedNodes.length = 0;

      const svc = createIncrementalService([BASELINE_FILES[0]]);
      await svc.init();
      await svc.indexChanges();

      expect(hierCalls.deleteByNotePath).toContain("notes/beta.md");
      expect(hierCalls.upsertNodeTree).toHaveLength(0);
      expect(sumCalls.propagateSummariesForChangedNodes).toHaveLength(0);
    });

    it("G3_baseline_fallback_flat_only — baseline fallback does not invoke hierarchical pipeline", async () => {
      const { store, calls: hierCalls } = createMockHierarchicalStore();
      const { service: summaryService, calls: sumCalls } = createMockSummaryService();

      const settings = createSettings();
      // Pre-seed plugin with malformed manifest to trigger MANIFEST_SHAPE_INVALID
      const corruptPlugin = createMemoryPlugin();
      await corruptPlugin.saveData("not-an-object");

      const service = new IndexingService({
        app: createMockApp(BASELINE_FILES),
        embeddingService: {
          init: async () => undefined,
          dispose: async () => undefined,
          embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
            return createEmbeddingResponse(request);
          }
        },
        vectorStoreRepository: createVectorStoreRepository().repo,
        getSettings: () => settings,
        manifestStore: new IndexManifestStore({
          plugin: corruptPlugin as unknown as RuntimeBootstrapContext["plugin"]
        }),
        jobStateStore: new IndexJobStateStore({
          plugin: corruptPlugin as unknown as RuntimeBootstrapContext["plugin"]
        }),
        summaryService,
        hierarchicalStore: store
      });

      await service.init();

      hierCalls.deleteByNotePath.length = 0;
      hierCalls.upsertNodeTree.length = 0;
      hierCalls.upsertEmbedding.length = 0;
      sumCalls.propagateSummariesForChangedNodes.length = 0;

      const snapshot = await service.indexChanges();

      expect(snapshot.status).toBe("succeeded");
      expect(hierCalls.upsertNodeTree).toHaveLength(0);
      expect(hierCalls.deleteByNotePath).toHaveLength(0);
      expect(sumCalls.propagateSummariesForChangedNodes).toHaveLength(0);
    });
  });
});
