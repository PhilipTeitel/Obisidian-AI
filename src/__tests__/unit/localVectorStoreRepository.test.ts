import { describe, expect, it } from "vitest";
import { LocalVectorStoreRepository } from "../../storage/LocalVectorStoreRepository";
import type { ChunkRecord, RuntimeBootstrapContext } from "../../types";

interface MemoryPluginLike {
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
}

const createMemoryPlugin = (initialData: unknown = null): MemoryPluginLike => {
  let data: unknown = initialData;
  return {
    loadData: async () => data,
    saveData: async (nextData) => {
      data = nextData;
    }
  };
};

const createChunk = (params: {
  id: string;
  notePath: string;
  noteTitle: string;
  content: string;
  updatedAt: number;
}): ChunkRecord => {
  return {
    id: params.id,
    source: {
      notePath: params.notePath,
      noteTitle: params.noteTitle,
      headingTrail: ["Top"],
      tags: ["ai", "mvp"]
    },
    content: params.content,
    hash: `hash-${params.id}`,
    updatedAt: params.updatedAt
  };
};

describe("LocalVectorStoreRepository", () => {
  it("initializes schema metadata and plugin-local storage paths", async () => {
    const repository = new LocalVectorStoreRepository({
      plugin: createMemoryPlugin() as unknown as RuntimeBootstrapContext["plugin"],
      pluginId: "obsidian-ai-mvp"
    });

    const metadata = await repository.getSchemaMetadata();
    expect(metadata.schemaVersion).toBeGreaterThan(0);
    expect(metadata.appliedMigrationIds.length).toBe(metadata.schemaVersion);
    expect(metadata.paths.rootDir).toContain(".obsidian/plugins/obsidian-ai-mvp/storage");
  });

  it("supports upsert, nearest-neighbor query, and delete by note path", async () => {
    const repository = new LocalVectorStoreRepository({
      plugin: createMemoryPlugin() as unknown as RuntimeBootstrapContext["plugin"],
      pluginId: "obsidian-ai-mvp"
    });

    const alpha = createChunk({
      id: "chunk-alpha",
      notePath: "notes/alpha.md",
      noteTitle: "alpha",
      content: "Alpha chunk",
      updatedAt: 1
    });
    const beta = createChunk({
      id: "chunk-beta",
      notePath: "notes/beta.md",
      noteTitle: "beta",
      content: "Beta chunk",
      updatedAt: 2
    });

    await repository.upsertFromChunks(
      [alpha, beta],
      [
        { values: [1, 0], dimensions: 2 },
        { values: [0.5, 0.5], dimensions: 2 }
      ]
    );

    const matches = await repository.queryNearestNeighbors({
      vector: { values: [1, 0], dimensions: 2 },
      topK: 5
    });
    expect(matches.map((match) => match.chunkId)).toEqual(["chunk-alpha", "chunk-beta"]);

    await repository.deleteByNotePaths(["notes/alpha.md"]);

    const afterDelete = await repository.queryNearestNeighbors({
      vector: { values: [1, 0], dimensions: 2 },
      topK: 5
    });
    expect(afterDelete.map((match) => match.chunkId)).toEqual(["chunk-beta"]);
  });
});
