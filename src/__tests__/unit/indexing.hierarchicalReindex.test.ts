import { describe, expect, it } from "vitest";
import { IndexingService } from "../../services/IndexingService";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import type {
  CrossReference,
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
  logLevel: "info"
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

const createVectorStoreRepository = () => ({
  getSchemaMetadata: async () => ({
    schemaVersion: 1,
    appliedMigrationIds: [],
    paths: {
      rootDir: ".obsidian/plugins/obsidian-ai-mvp/storage",
      sqliteDbPath: ".obsidian/plugins/obsidian-ai-mvp/storage/vector-store.sqlite3",
      migrationsDir: ".obsidian/plugins/obsidian-ai-mvp/storage/migrations"
    }
  }),
  replaceAllFromChunks: async () => undefined,
  upsertFromChunks: async () => undefined,
  deleteByNotePaths: async () => undefined,
  queryNearestNeighbors: async () => []
});

interface HierarchicalStoreCalls {
  upsertNodeTree: DocumentTree[];
  upsertCrossReferences: CrossReference[][];
  upsertTags: Array<{ nodeId: string; tags: string[] }>;
  upsertEmbedding: Array<{ nodeId: string; embeddingType: EmbeddingType; vector: EmbeddingVector }>;
  getSummary: string[];
}

const createMockHierarchicalStore = (
  summaryMap: Map<string, SummaryRecord> = new Map()
): { store: HierarchicalStoreContract; calls: HierarchicalStoreCalls } => {
  const calls: HierarchicalStoreCalls = {
    upsertNodeTree: [],
    upsertCrossReferences: [],
    upsertTags: [],
    upsertEmbedding: [],
    getSummary: []
  };

  const store: HierarchicalStoreContract = {
    upsertNodeTree: async (tree: DocumentTree) => {
      calls.upsertNodeTree.push(tree);
    },
    deleteByNotePath: async () => undefined,
    getNode: async () => null,
    getChildren: async () => [],
    getAncestorChain: async () => [],
    getSiblings: async () => [],
    getNodesByNotePath: async () => [],
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
    upsertCrossReferences: async (refs: CrossReference[]) => {
      calls.upsertCrossReferences.push(refs);
    },
    getCrossReferences: async () => []
  };

  return { store, calls };
};

interface SummaryServiceCalls {
  generateSummaries: DocumentTree[];
}

const createMockSummaryService = (
  opts: { throwForNotePath?: string } = {}
): { service: SummaryServiceContract; calls: SummaryServiceCalls } => {
  const calls: SummaryServiceCalls = { generateSummaries: [] };

  const service: SummaryServiceContract = {
    init: async () => undefined,
    dispose: async () => undefined,
    generateSummaries: async (tree: DocumentTree) => {
      if (opts.throwForNotePath && tree.root.notePath === opts.throwForNotePath) {
        throw new Error(`Summary generation failed for ${tree.root.notePath}`);
      }
      calls.generateSummaries.push(tree);
      return [];
    },
    regenerateFromNode: async () => [],
    detectStaleSummaries: async () => [],
    propagateSummariesForChangedNodes: async () => []
  };

  return { service, calls };
};

const SAMPLE_FILES: MockVaultFile[] = [
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

const createService = (opts: {
  files?: MockVaultFile[];
  summaryService?: SummaryServiceContract;
  hierarchicalStore?: HierarchicalStoreContract;
  embeddingRequests?: EmbeddingRequest[];
  embedFn?: (request: EmbeddingRequest) => Promise<EmbeddingResponse>;
}) => {
  const settings = createSettings();
  const plugin = createMemoryPlugin();
  const files = opts.files ?? SAMPLE_FILES;
  const embeddingRequests = opts.embeddingRequests ?? [];

  return new IndexingService({
    app: createMockApp(files),
    embeddingService: {
      init: async () => undefined,
      dispose: async () => undefined,
      embed: opts.embedFn ?? (async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
        embeddingRequests.push(request);
        return createEmbeddingResponse(request);
      })
    },
    vectorStoreRepository: createVectorStoreRepository(),
    getSettings: () => settings,
    manifestStore: new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    }),
    jobStateStore: new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    }),
    summaryService: opts.summaryService ?? createMockSummaryService().service,
    hierarchicalStore: opts.hierarchicalStore ?? createMockHierarchicalStore().store
  });
};

describe("hierarchical reindex pipeline", () => {
  it("A1_deps_include_new_services — IndexingServiceDeps includes summaryService and hierarchicalStore", () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    expect(svc).toBeDefined();
  });

  it("A2_bootstrap_passes_deps — service constructs with both new deps", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    const snapshot = await svc.reindexVault();
    expect(snapshot.status).toBe("succeeded");
  });

  it("B1_builds_document_trees — buildDocumentTree is called for each crawled note", async () => {
    const { store, calls } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    expect(calls.upsertNodeTree).toHaveLength(2);
    const notePaths = calls.upsertNodeTree.map((tree) => tree.root.notePath);
    expect(notePaths).toContain("notes/alpha.md");
    expect(notePaths).toContain("notes/beta.md");
  });

  it("B2_stores_node_trees — each tree is stored via upsertNodeTree", async () => {
    const { store, calls } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    expect(calls.upsertNodeTree).toHaveLength(2);
    for (const tree of calls.upsertNodeTree) {
      expect(tree.root).toBeDefined();
      expect(tree.nodes.size).toBeGreaterThan(0);
    }
  });

  it("B3_stores_cross_references — cross-references are stored via upsertCrossReferences", async () => {
    const { store, calls } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    expect(calls.upsertCrossReferences).toHaveLength(2);
  });

  it("B4_stores_node_tags — tags are stored for each node with non-empty tags", async () => {
    const filesWithTags: MockVaultFile[] = [
      {
        path: "notes/tagged.md",
        basename: "tagged",
        markdown: "---\ntags: [project, important]\n---\n# Tagged Note\n\nContent with #inline-tag here.",
        mtime: 100
      }
    ];
    const { store, calls } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ files: filesWithTags, summaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    expect(calls.upsertTags.length).toBeGreaterThan(0);
    for (const tagCall of calls.upsertTags) {
      expect(tagCall.tags.length).toBeGreaterThan(0);
    }
  });

  it("C1_generates_summaries — summaryService.generateSummaries is called for each tree", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService, calls: summaryCalls } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    expect(summaryCalls.generateSummaries).toHaveLength(2);
    const notePaths = summaryCalls.generateSummaries.map((tree) => tree.root.notePath);
    expect(notePaths).toContain("notes/alpha.md");
    expect(notePaths).toContain("notes/beta.md");
  });

  it("C2_summary_error_non_fatal — summary generation error for one tree does not abort reindex", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService, calls: summaryCalls } = createMockSummaryService({
      throwForNotePath: "notes/alpha.md"
    });
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    const snapshot = await svc.reindexVault();

    expect(snapshot.status).toBe("succeeded");
    expect(summaryCalls.generateSummaries).toHaveLength(1);
    expect(summaryCalls.generateSummaries[0].root.notePath).toBe("notes/beta.md");
  });

  it("D1_embeds_leaf_content — leaf nodes (paragraph, bullet) are embedded with type 'content'", async () => {
    const { store, calls } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    const contentEmbeddings = calls.upsertEmbedding.filter((e) => e.embeddingType === "content");
    expect(contentEmbeddings.length).toBeGreaterThan(0);
    for (const emb of contentEmbeddings) {
      expect(emb.vector.values).toEqual([0.1, 0.2]);
    }
  });

  it("D2_embeds_non_leaf_summaries — non-leaf nodes with summaries are embedded with type 'summary'", async () => {
    const summaryMap = new Map<string, SummaryRecord>();

    const { store: tempStore } = createMockHierarchicalStore();
    const tempService = createService({ hierarchicalStore: tempStore });
    await tempService.init();

    const { store, calls } = createMockHierarchicalStore(summaryMap);

    const interceptedTrees: DocumentTree[] = [];
    const { service: summaryService } = createMockSummaryService();
    const wrappedSummaryService: SummaryServiceContract = {
      ...summaryService,
      generateSummaries: async (tree: DocumentTree) => {
        interceptedTrees.push(tree);
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
      }
    };

    const svc = createService({ summaryService: wrappedSummaryService, hierarchicalStore: store });
    await svc.init();
    await svc.reindexVault();

    const summaryEmbeddings = calls.upsertEmbedding.filter((e) => e.embeddingType === "summary");
    expect(summaryEmbeddings.length).toBeGreaterThan(0);
  });

  it("D3_uses_configured_embedding_settings — embedding uses configured provider and model", async () => {
    const embeddingRequests: EmbeddingRequest[] = [];
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({
      summaryService,
      hierarchicalStore: store,
      embeddingRequests
    });
    await svc.init();
    await svc.reindexVault();

    for (const req of embeddingRequests) {
      expect(req.providerId).toBe("openai");
      expect(req.model).toBe("text-embedding-3-small");
    }
  });

  it("D4_embedding_error_recovery — embedding error includes recovery action", async () => {
    const { store } = createMockHierarchicalStore();
    const summaryMap = new Map<string, SummaryRecord>();
    const { store: storeWithSummaries } = createMockHierarchicalStore(summaryMap);

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
      propagateSummariesForChangedNodes: async () => []
    };

    let embedCallCount = 0;
    const svc = createService({
      summaryService: wrappedSummaryService,
      hierarchicalStore: storeWithSummaries,
      embedFn: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
        embedCallCount++;
        if (embedCallCount === 1) {
          return createEmbeddingResponse(request);
        }
        throw new Error("Embedding provider timeout");
      }
    });
    await svc.init();

    try {
      await svc.reindexVault();
      expect.fail("Expected reindex to throw");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("Recovery action:");
    }
  });

  it("E1_progress_stage_order — progress stages follow Crawl → Chunk → Store → Summarize → Embed → Finalize", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();

    const snapshots: JobSnapshot[] = [];
    await svc.reindexVault({
      onProgress: (snapshot) => snapshots.push(snapshot)
    });

    const labels = snapshots.map((s) => s.progress.label);
    expect(labels.some((l) => l.includes("Crawl"))).toBe(true);
    expect(labels.some((l) => l.includes("Chunk"))).toBe(true);
    expect(labels.some((l) => l.includes("Store"))).toBe(true);
    expect(labels.some((l) => l.includes("Summarize"))).toBe(true);
    expect(labels.some((l) => l.includes("Embed"))).toBe(true);
    expect(labels.some((l) => l.includes("Finalize"))).toBe(true);

    const stageOrder = ["Crawl", "Chunk", "Store", "Summarize", "Embed", "Finalize"];
    const stageIndices = stageOrder.map((stage) =>
      labels.findIndex((l) => l.includes(stage))
    );
    for (let i = 1; i < stageIndices.length; i++) {
      expect(stageIndices[i]).toBeGreaterThan(stageIndices[i - 1]);
    }
  });

  it("E2_store_stage_detail — Store stage reports the number of trees being stored", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();

    const snapshots: JobSnapshot[] = [];
    await svc.reindexVault({
      onProgress: (snapshot) => snapshots.push(snapshot)
    });

    const storeSnapshot = snapshots.find((s) => s.progress.label.includes("Store"));
    expect(storeSnapshot).toBeDefined();
    expect(storeSnapshot!.progress.detail).toContain("2");
    expect(storeSnapshot!.progress.detail).toContain("trees");
  });

  it("E3_summarize_stage_detail — Summarize stage reports summary generation progress", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();

    const snapshots: JobSnapshot[] = [];
    await svc.reindexVault({
      onProgress: (snapshot) => snapshots.push(snapshot)
    });

    const summarizeSnapshot = snapshots.find((s) => s.progress.label.includes("Summarize"));
    expect(summarizeSnapshot).toBeDefined();
    expect(summarizeSnapshot!.progress.detail).toContain("2");
    expect(summarizeSnapshot!.progress.detail).toContain("trees");
  });

  it("E4_embed_stage_detail — Embed stage reports the total number of nodes being embedded", async () => {
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();
    const svc = createService({ summaryService, hierarchicalStore: store });
    await svc.init();

    const snapshots: JobSnapshot[] = [];
    await svc.reindexVault({
      onProgress: (snapshot) => snapshots.push(snapshot)
    });

    const embedSnapshot = snapshots.find((s) => s.progress.label.includes("Embed"));
    expect(embedSnapshot).toBeDefined();
    expect(embedSnapshot!.progress.detail).toContain("nodes");
  });

  it("F1_flat_pipeline_preserved — flat pipeline still runs alongside hierarchical", async () => {
    const replaceAllCalls: Array<{ chunkCount: number }> = [];
    const { store } = createMockHierarchicalStore();
    const { service: summaryService } = createMockSummaryService();

    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const svc = new IndexingService({
      app: createMockApp(SAMPLE_FILES),
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: {
        ...createVectorStoreRepository(),
        replaceAllFromChunks: async (chunks: unknown[]) => {
          replaceAllCalls.push({ chunkCount: chunks.length });
        }
      },
      getSettings: () => settings,
      manifestStore: new IndexManifestStore({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
      }),
      jobStateStore: new IndexJobStateStore({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
      }),
      summaryService,
      hierarchicalStore: store
    });

    await svc.init();
    const snapshot = await svc.reindexVault();

    expect(snapshot.status).toBe("succeeded");
    expect(replaceAllCalls).toHaveLength(1);
    expect(replaceAllCalls[0].chunkCount).toBeGreaterThan(0);
  });

  it("G1_empty_vault_no_hierarchical_calls — zero notes produces clean success with no hierarchical calls", async () => {
    const { store, calls } = createMockHierarchicalStore();
    const { service: summaryService, calls: summaryCalls } = createMockSummaryService();
    const svc = createService({ files: [], summaryService, hierarchicalStore: store });
    await svc.init();
    const snapshot = await svc.reindexVault();

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.progress.detail).toBe("Indexed 0 notes into 0 chunks.");
    expect(calls.upsertNodeTree).toHaveLength(0);
    expect(calls.upsertCrossReferences).toHaveLength(0);
    expect(calls.upsertTags).toHaveLength(0);
    expect(calls.upsertEmbedding).toHaveLength(0);
    expect(summaryCalls.generateSummaries).toHaveLength(0);
  });
});
