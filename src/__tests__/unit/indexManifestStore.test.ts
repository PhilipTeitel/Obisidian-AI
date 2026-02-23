import { describe, expect, it } from "vitest";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import type { RuntimeBootstrapContext } from "../../types";

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

describe("IndexManifestStore", () => {
  it("returns an empty baseline manifest by default", async () => {
    const plugin = createMemoryPlugin();
    const store = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    await expect(store.load()).resolves.toEqual({
      version: 1,
      updatedAt: 0,
      notes: []
    });
  });

  it("persists and reloads versioned note fingerprints", async () => {
    const plugin = createMemoryPlugin({
      unrelated: true
    });
    const store = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    await store.save({
      version: 1,
      updatedAt: 123,
      notes: [
        { notePath: "notes/zeta.md", noteHash: "z1", updatedAt: 10 },
        { notePath: "notes/alpha.md", noteHash: "a1", updatedAt: 20 }
      ]
    });

    await expect(store.load()).resolves.toEqual({
      version: 1,
      updatedAt: 123,
      notes: [
        { notePath: "notes/alpha.md", noteHash: "a1", updatedAt: 20 },
        { notePath: "notes/zeta.md", noteHash: "z1", updatedAt: 10 }
      ]
    });
  });

  it("falls back safely for malformed manifest payloads", async () => {
    const plugin = createMemoryPlugin({
      indexManifest: {
        version: 1,
        notes: "broken"
      }
    });
    const store = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    const result = await store.loadWithIssues();
    expect(result.manifest).toEqual({
      version: 1,
      updatedAt: 0,
      notes: []
    });
    expect(result.issues).toEqual([
      {
        code: "MANIFEST_SHAPE_INVALID",
        message: "Persisted index manifest payload is malformed and will be reset.",
        recoverable: true
      }
    ]);
  });

  it("flags unsupported manifest versions and falls back to baseline", async () => {
    const plugin = createMemoryPlugin({
      indexManifest: {
        version: 999,
        updatedAt: 10,
        notes: []
      }
    });
    const store = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    const result = await store.loadWithIssues();
    expect(result.manifest.notes).toEqual([]);
    expect(result.issues[0]?.code).toBe("MANIFEST_VERSION_UNSUPPORTED");
  });
});
