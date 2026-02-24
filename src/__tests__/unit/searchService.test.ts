import { describe, expect, it } from "vitest";
import { SearchService } from "../../services/SearchService";
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  ObsidianAISettings,
  VectorStoreQuery
} from "../../types";

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

const createEmbeddingResponse = (request: EmbeddingRequest): EmbeddingResponse => {
  return {
    providerId: request.providerId,
    model: request.model,
    vectors: request.inputs.map(() => ({
      values: [0.5, 0.5],
      dimensions: 2
    }))
  };
};

describe("SearchService", () => {
  it("A1_embeds_query_with_active_provider", async () => {
    const settings = createSettings();
    settings.embeddingProvider = "ollama";
    settings.embeddingModel = "nomic-embed-text";
    const embeddingRequests: EmbeddingRequest[] = [];

    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async () => []
      },
      getSettings: () => settings
    });

    await service.init();
    await service.search({ query: "semantic query", topK: 5 });

    expect(embeddingRequests).toHaveLength(1);
    expect(embeddingRequests[0]).toEqual({
      providerId: "ollama",
      model: "nomic-embed-text",
      inputs: ["semantic query"]
    });
  });

  it("A2_forwards_topk_and_minscore", async () => {
    const settings = createSettings();
    const embeddingRequests: EmbeddingRequest[] = [];
    const vectorQueries: VectorStoreQuery[] = [];

    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async (query: VectorStoreQuery) => {
          vectorQueries.push(query);
          return [];
        }
      },
      getSettings: () => settings
    });

    await service.init();
    await service.search({ query: "alpha", topK: 7, minScore: 0.33 });
    const emptyTopKResults = await service.search({ query: "alpha", topK: 0, minScore: 0.5 });
    const emptyQueryResults = await service.search({ query: "   ", topK: 2 });

    expect(vectorQueries).toHaveLength(1);
    expect(vectorQueries[0]?.topK).toBe(7);
    expect(vectorQueries[0]?.minScore).toBe(0.33);
    expect(embeddingRequests).toHaveLength(1);
    expect(emptyTopKResults).toEqual([]);
    expect(emptyQueryResults).toEqual([]);
  });

  it("A3_maps_ranked_results_with_metadata", async () => {
    const settings = createSettings();

    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => createEmbeddingResponse(request)
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async () => [
          {
            chunkId: "chunk-2",
            score: 0.92,
            notePath: "notes/alpha.md",
            noteTitle: "Alpha",
            heading: "Section A",
            snippet: "Snippet A",
            tags: [" b", "a", "a", ""],
            embedding: { values: [1, 0], dimensions: 2 },
            updatedAt: 1
          },
          {
            chunkId: "chunk-1",
            score: 0.81,
            notePath: "notes/beta.md",
            noteTitle: "Beta",
            heading: undefined,
            snippet: "Snippet B",
            tags: [],
            embedding: { values: [0, 1], dimensions: 2 },
            updatedAt: 2
          }
        ]
      },
      getSettings: () => settings
    });

    await service.init();
    const results = await service.search({ query: "ranked", topK: 10 });

    expect(results).toEqual([
      {
        chunkId: "chunk-2",
        score: 0.92,
        notePath: "notes/alpha.md",
        noteTitle: "Alpha",
        heading: "Section A",
        snippet: "Snippet A",
        tags: ["a", "b"]
      },
      {
        chunkId: "chunk-1",
        score: 0.81,
        notePath: "notes/beta.md",
        noteTitle: "Beta",
        heading: undefined,
        snippet: "Snippet B",
        tags: []
      }
    ]);
  });

  it("B1_rejects_when_disposed", async () => {
    const settings = createSettings();

    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => createEmbeddingResponse(request)
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async () => []
      },
      getSettings: () => settings
    });

    await service.init();
    await service.dispose();

    await expect(service.search({ query: "after-dispose", topK: 1 })).rejects.toThrow("SearchService is disposed.");
    await expect(service.searchSelection("after-dispose")).rejects.toThrow("SearchService is disposed.");
    await expect(service.searchSelection("   ")).rejects.toThrow("SearchService is disposed.");
  });

  it("B2_normalizes_dependency_failures", async () => {
    const settings = createSettings();

    const embeddingFailureService = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async () => {
          throw new Error("OpenAI provider returned 401 unauthorized");
        }
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async () => []
      },
      getSettings: () => settings
    });

    await embeddingFailureService.init();
    await expect(embeddingFailureService.search({ query: "query", topK: 5 })).rejects.toMatchObject({
      domain: "provider",
      code: "PROVIDER_AUTH_FAILURE",
      retryable: false,
      context: {
        operation: "SearchService.search"
      }
    });

    const storageFailureService = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => createEmbeddingResponse(request)
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async () => {
          throw new Error("sqlite disk I/O error");
        }
      },
      getSettings: () => settings
    });

    await storageFailureService.init();
    await expect(storageFailureService.search({ query: "query", topK: 5 })).rejects.toMatchObject({
      domain: "storage",
      code: "STORAGE_IO_FAILURE",
      retryable: false,
      context: {
        operation: "SearchService.search"
      }
    });
  });

  it("B3_selection_path_defaults_and_guards", async () => {
    const settings = createSettings();
    const embeddingRequests: EmbeddingRequest[] = [];
    const vectorQueries: VectorStoreQuery[] = [];

    const service = new SearchService({
      embeddingService: {
        init: async () => undefined,
        dispose: async () => undefined,
        embed: async (request: EmbeddingRequest): Promise<EmbeddingResponse> => {
          embeddingRequests.push(request);
          return createEmbeddingResponse(request);
        }
      },
      vectorStoreRepository: {
        getSchemaMetadata: async () => ({
          schemaVersion: 1,
          appliedMigrationIds: [],
          paths: {
            rootDir: "root",
            sqliteDbPath: "db.sqlite3",
            migrationsDir: "migrations"
          }
        }),
        replaceAllFromChunks: async () => undefined,
        upsertFromChunks: async () => undefined,
        deleteByNotePaths: async () => undefined,
        queryNearestNeighbors: async (query: VectorStoreQuery) => {
          vectorQueries.push(query);
          return [];
        }
      },
      getSettings: () => settings
    });

    await service.init();
    await service.searchSelection("  selected paragraph  ");
    const emptySelectionResults = await service.searchSelection("   ");

    expect(vectorQueries).toHaveLength(1);
    expect(vectorQueries[0]?.topK).toBe(5);
    expect(embeddingRequests).toHaveLength(1);
    expect(embeddingRequests[0]?.inputs).toEqual(["selected paragraph"]);
    expect(emptySelectionResults).toEqual([]);
  });
});
