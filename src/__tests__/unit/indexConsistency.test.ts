import { describe, expect, it } from "vitest";
import { IndexJobStateStore } from "../../services/indexing/IndexJobStateStore";
import { IndexManifestStore } from "../../services/indexing/IndexManifestStore";
import { applyRecoveryActions, runConsistencyPreflight } from "../../services/indexing/indexConsistency";
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

const createRunningJob = (): JobSnapshot => {
  return {
    id: "job-1",
    type: "index-changes",
    status: "running",
    startedAt: 123,
    progress: {
      completed: 0,
      total: 1,
      label: "Index changes · Crawl",
      detail: "Scanning"
    }
  };
};

describe("index consistency checks", () => {
  it("returns healthy preflight report when persisted state is valid", async () => {
    const plugin = createMemoryPlugin();
    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    const report = await runConsistencyPreflight({
      manifestStore,
      jobStateStore
    });

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.requiresFullReindexBaseline).toBe(false);
  });

  it("detects stale active jobs and invalid manifests, then applies recovery", async () => {
    const plugin = createMemoryPlugin({
      indexManifest: {
        version: 1,
        notes: "broken"
      },
      indexJobState: {
        activeJob: createRunningJob(),
        history: []
      }
    });

    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    const report = await runConsistencyPreflight({
      manifestStore,
      jobStateStore
    });

    expect(report.ok).toBe(false);
    expect(report.requiresFullReindexBaseline).toBe(true);
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      "MANIFEST_SHAPE_INVALID",
      "STALE_ACTIVE_JOB"
    ]);

    const actions = await applyRecoveryActions(report, {
      manifestStore,
      jobStateStore
    });

    expect(actions.recoveryMessages.length).toBe(2);
    await expect(jobStateStore.getActiveJob()).resolves.toBeNull();
    await expect(manifestStore.load()).resolves.toEqual({
      version: 1,
      updatedAt: expect.any(Number),
      notes: []
    });
  });

  it("does not apply any recovery steps when report is healthy", async () => {
    const plugin = createMemoryPlugin();
    const manifestStore = new IndexManifestStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });
    const jobStateStore = new IndexJobStateStore({
      plugin: plugin as unknown as RuntimeBootstrapContext["plugin"]
    });

    const report = await runConsistencyPreflight({
      manifestStore,
      jobStateStore
    });
    const actions = await applyRecoveryActions(report, {
      manifestStore,
      jobStateStore
    });

    expect(actions.recoveryMessages).toEqual([]);
  });
});
