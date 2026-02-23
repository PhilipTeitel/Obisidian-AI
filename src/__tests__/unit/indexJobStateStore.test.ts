import { describe, expect, it } from "vitest";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import type { JobSnapshot, RuntimeBootstrapContext } from "../../types";

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

const createSnapshot = (id: string, status: JobSnapshot["status"], startedAt: number): JobSnapshot => {
  return {
    id,
    type: "reindex-vault",
    status,
    startedAt,
    finishedAt: status === "running" ? undefined : startedAt + 1,
    progress: {
      completed: 0,
      total: 1,
      label: "Indexing",
      detail: "Testing"
    }
  };
};

describe("IndexJobStateStore", () => {
  it("returns empty defaults when no state exists", async () => {
    const store = new IndexJobStateStore({
      plugin: createMemoryPlugin() as unknown as RuntimeBootstrapContext["plugin"]
    });

    await expect(store.load()).resolves.toEqual({
      activeJob: null,
      lastCompletedJob: null,
      history: []
    });
  });

  it("tracks active job then promotes terminal snapshot to last/history", async () => {
    const store = new IndexJobStateStore({
      plugin: createMemoryPlugin() as unknown as RuntimeBootstrapContext["plugin"],
      historyLimit: 2
    });

    const running = createSnapshot("job-1", "running", 10);
    await store.markActiveJob(running);
    await expect(store.getActiveJob()).resolves.toEqual(running);

    const succeeded = createSnapshot("job-1", "succeeded", 10);
    await store.markJobCompleted(succeeded);

    const state = await store.load();
    expect(state.activeJob).toBeNull();
    expect(state.lastCompletedJob?.id).toBe("job-1");
    expect(state.history).toHaveLength(1);
  });

  it("enforces bounded history retention", async () => {
    const store = new IndexJobStateStore({
      plugin: createMemoryPlugin() as unknown as RuntimeBootstrapContext["plugin"],
      historyLimit: 2
    });

    await store.markJobCompleted(createSnapshot("job-1", "succeeded", 10));
    await store.markJobCompleted(createSnapshot("job-2", "failed", 20));
    await store.markJobCompleted(createSnapshot("job-3", "succeeded", 30));

    const state = await store.load();
    expect(state.history.map((entry) => entry.id)).toEqual(["job-3", "job-2"]);
  });

  it("falls back to empty state for malformed payloads", async () => {
    const store = new IndexJobStateStore({
      plugin: createMemoryPlugin({
        indexJobState: {
          activeJob: "broken",
          history: "broken"
        }
      }) as unknown as RuntimeBootstrapContext["plugin"]
    });

    await expect(store.load()).resolves.toEqual({
      activeJob: null,
      lastCompletedJob: null,
      history: []
    });
  });
});
