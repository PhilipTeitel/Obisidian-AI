import { describe, expect, it } from "vitest";
import { IndexingService, computeIncrementalDiff } from "../../services/IndexingService";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  IndexedNoteFingerprint,
  ObsidianAISettings,
  RuntimeBootstrapContext
} from "../../types";
import { chunkMarkdownNote } from "../../utils/chunker";
import { hashNormalizedMarkdown } from "../../utils/hasher";

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
    chatTimeout: 30000
  };
};

const createMemoryPlugin = (initialData: unknown = null): MemoryPluginLike => {
  let data: unknown = initialData;
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

const createFingerprint = (path: string, markdown: string, updatedAt: number): IndexedNoteFingerprint => {
  return {
    notePath: path,
    noteHash: hashNormalizedMarkdown(markdown),
    updatedAt
  };
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

describe("incremental indexing workflow", () => {
  it("classifies created, updated, unchanged, and deleted notes deterministically", () => {
    const previous = [
      { notePath: "notes/a.md", noteHash: "hash-a", updatedAt: 10 },
      { notePath: "notes/b.md", noteHash: "hash-b", updatedAt: 20 },
      { notePath: "notes/deleted.md", noteHash: "hash-x", updatedAt: 30 }
    ];
    const current = [
      { notePath: "notes/a.md", noteHash: "hash-a", updatedAt: 40 },
      { notePath: "notes/b.md", noteHash: "hash-b-new", updatedAt: 50 },
      { notePath: "notes/c.md", noteHash: "hash-c", updatedAt: 60 }
    ];

    const diff = computeIncrementalDiff(previous, current);

    expect(diff.created.map((entry) => entry.notePath)).toEqual(["notes/c.md"]);
    expect(diff.updated.map((entry) => entry.notePath)).toEqual(["notes/b.md"]);
    expect(diff.unchanged.map((entry) => entry.notePath)).toEqual(["notes/a.md"]);
    expect(diff.deleted.map((entry) => entry.notePath)).toEqual(["notes/deleted.md"]);
  });

  it("indexes only created and updated notes and reports deleted counts", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    await manifestStore.save({
      version: 1,
      updatedAt: 1,
      notes: [
        createFingerprint("notes/a.md", "# A\n\nSame", 10),
        createFingerprint("notes/b.md", "# B\n\nOld", 20),
        createFingerprint("notes/deleted.md", "# Deleted\n\nGone", 30)
      ]
    });

    const files: MockVaultFile[] = [
      { path: "notes/a.md", basename: "a", markdown: "# A\n\nSame", mtime: 100 },
      { path: "notes/b.md", basename: "b", markdown: "# B\n\nUpdated body", mtime: 200 },
      { path: "notes/c.md", basename: "c", markdown: "# C\n\nBrand new", mtime: 300 }
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
      manifestStore,
      jobStateStore
    });

    await service.init();
    const snapshot = await service.indexChanges();

    const expectedChunkInputs = files
      .filter((file) => file.path === "notes/b.md" || file.path === "notes/c.md")
      .flatMap((file) =>
        chunkMarkdownNote({
          notePath: file.path,
          noteTitle: file.basename,
          markdown: file.markdown,
          updatedAt: file.mtime
        }).map((chunk) => chunk.content)
      );

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.progress.detail).toBe(
      `Created 1, updated 1, deleted 1 notes; embedded ${expectedChunkInputs.length} chunks.`
    );
    expect(embeddingRequests).toHaveLength(1);
    expect(embeddingRequests[0]?.inputs).toEqual(expectedChunkInputs);

    const manifestAfterRun = await manifestStore.load();
    expect(manifestAfterRun.notes.map((entry) => entry.notePath)).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"]);
  });

  it("short-circuits with no changes and does not call embedding service", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    await manifestStore.save({
      version: 1,
      updatedAt: 1,
      notes: [createFingerprint("notes/a.md", "# A\n\nStable", 10)]
    });

    const embeddingRequests: EmbeddingRequest[] = [];
    const service = new IndexingService({
      app: createMockApp([{ path: "notes/a.md", basename: "a", markdown: "# A\n\nStable", mtime: 10 }]),
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
      manifestStore,
      jobStateStore
    });

    await service.init();
    const snapshot = await service.indexChanges();

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.progress.detail).toBe("No changes detected. Created 0, updated 0, deleted 0.");
    expect(embeddingRequests).toHaveLength(0);
  });

  it("does not delete note paths when embedding fails during incremental indexing", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    await manifestStore.save({
      version: 1,
      updatedAt: 1,
      notes: [createFingerprint("notes/a.md", "# A\n\nOld", 10)]
    });

    const deletedPaths: string[][] = [];
    const service = new IndexingService({
      app: createMockApp([{ path: "notes/a.md", basename: "a", markdown: "# A\n\nUpdated", mtime: 20 }]),
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async () => {
          throw new Error("Embedding provider timed out during incremental run.");
        }
      },
      vectorStoreRepository: {
        ...createVectorStoreRepository(),
        deleteByNotePaths: async (paths: string[]) => {
          deletedPaths.push(paths);
        }
      },
      getSettings: () => settings,
      manifestStore,
      jobStateStore
    });

    await service.init();
    await expect(service.indexChanges()).rejects.toThrow("Recovery action:");
    expect(deletedPaths).toHaveLength(0);
  });

  it("retries transient provider failures before marking incremental indexing failed", async () => {
    const settings = createSettings();
    const plugin = createMemoryPlugin();
    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    await manifestStore.save({
      version: 1,
      updatedAt: 1,
      notes: [createFingerprint("notes/a.md", "# A\n\nOld", 10)]
    });

    let embedCallCount = 0;
    const progressDetails: string[] = [];
    const service = new IndexingService({
      app: createMockApp([{ path: "notes/a.md", basename: "a", markdown: "# A\n\nUpdated", mtime: 20 }]),
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embedCallCount += 1;
          if (embedCallCount === 1) {
            throw new Error("Provider timeout while embedding incremental chunks.");
          }
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: createVectorStoreRepository(),
      getSettings: () => settings,
      manifestStore,
      jobStateStore
    });

    await service.init();
    const snapshot = await service.indexChanges({
      onProgress: (nextSnapshot) => {
        progressDetails.push(nextSnapshot.progress.detail);
      }
    });

    expect(snapshot.status).toBe("succeeded");
    expect(embedCallCount).toBe(2);
    expect(progressDetails.some((detail) => detail.includes("retrying indexing attempt 2 of 2"))).toBe(true);
  });
});
