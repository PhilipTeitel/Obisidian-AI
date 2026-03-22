import { describe, expect, it } from "vitest";
import { IndexingService } from "../../services/IndexingService";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import type { EmbeddingRequest, EmbeddingResponse, ObsidianAISettings, RuntimeBootstrapContext } from "../../types";
import { chunkMarkdownNote } from "../../utils/chunker";

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

const createSettings = (): ObsidianAISettings => {
  return {
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
  };
};

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
  const filesByPath = new Map<string, MockVaultFile>(files.map((file) => [file.path, file]));
  return {
    vault: {
      getMarkdownFiles: () => {
        return files.map((file) => ({
          path: file.path,
          basename: file.basename,
          stat: {
            mtime: file.mtime
          }
        }));
      },
      cachedRead: async (file: { path: string }) => {
        return filesByPath.get(file.path)?.markdown ?? "";
      }
    }
  } as unknown as RuntimeBootstrapContext["app"];
};

const createEmbeddingResponse = (request: EmbeddingRequest): EmbeddingResponse => {
  return {
    providerId: request.providerId,
    model: request.model,
    vectors: request.inputs.map(() => ({
      values: [0.1, 0.2],
      dimensions: 2
    }))
  };
};

const createVectorStoreRepository = () => {
  return {
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
  };
};

const createMockSummaryService = () => ({
  init: async () => undefined,
  dispose: async () => undefined,
  generateSummaries: async () => [],
  regenerateFromNode: async () => [],
  detectStaleSummaries: async () => [],
  propagateSummariesForChangedNodes: async () => []
});

const createMockHierarchicalStore = () => ({
  upsertNodeTree: async () => undefined,
  deleteByNotePath: async () => undefined,
  getNode: async () => null,
  getChildren: async () => [],
  getAncestorChain: async () => [],
  getSiblings: async () => [],
  getNodesByNotePath: async () => [],
  searchSummaryEmbeddings: async () => [],
  searchContentEmbeddings: async () => [],
  upsertSummary: async () => undefined,
  getSummary: async () => null,
  upsertEmbedding: async () => undefined,
  upsertTags: async () => undefined,
  upsertCrossReferences: async () => undefined,
  getCrossReferences: async () => []
});

describe("indexing reindex flow", () => {
  it("runs crawl -> chunk -> embed and returns counted success snapshot", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const files: MockVaultFile[] = [
      {
        path: "notes/alpha.md",
        basename: "alpha",
        markdown: "# Alpha\n\nFirst paragraph.\n- bullet one",
        mtime: 100
      },
      {
        path: "notes/beta.md",
        basename: "beta",
        markdown: "# Beta\n\nSecond paragraph",
        mtime: 200
      }
    ];

    const embeddingRequests: EmbeddingRequest[] = [];
    const service = new IndexingService({
      app: createMockApp(files),
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: createVectorStoreRepository(),
      getSettings: () => settings,
      manifestStore: new IndexManifestStore({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
      }),
      jobStateStore: new IndexJobStateStore({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
      }),
      summaryService: createMockSummaryService(),
      hierarchicalStore: createMockHierarchicalStore()
    });

    await service.init();
    const snapshot = await service.reindexVault();

    const expectedInputs = files.flatMap((file) =>
      chunkMarkdownNote({
        notePath: file.path,
        noteTitle: file.basename,
        markdown: file.markdown,
        updatedAt: file.mtime
      }).map((chunk) => chunk.content)
    );

    expect(snapshot.type).toBe("reindex-vault");
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.progress.detail).toBe(`Indexed 2 notes into ${expectedInputs.length} chunks.`);
    expect(embeddingRequests.length).toBeGreaterThanOrEqual(1);
  });

  it("returns deterministic empty success snapshot and skips embed call", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const embeddingRequests: EmbeddingRequest[] = [];

    const service = new IndexingService({
      app: createMockApp([]),
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: createVectorStoreRepository(),
      getSettings: () => settings,
      manifestStore: new IndexManifestStore({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
      }),
      jobStateStore: new IndexJobStateStore({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
      }),
      summaryService: createMockSummaryService(),
      hierarchicalStore: createMockHierarchicalStore()
    });

    await service.init();
    const snapshot = await service.reindexVault();

    expect(snapshot.type).toBe("reindex-vault");
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.progress.detail).toBe("Indexed 0 notes into 0 chunks.");
    expect(embeddingRequests).toHaveLength(0);
  });
});
