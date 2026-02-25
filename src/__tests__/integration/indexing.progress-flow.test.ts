import { describe, expect, it } from "vitest";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";
import type { JobSnapshot } from "../../types";

const seedVault = (harness: ReturnType<typeof createPluginTestHarness>): void => {
  harness.appHarness.setVaultMarkdownFiles([
    {
      path: "notes/one.md",
      markdown: "# One\n\nAlpha paragraph",
      mtime: 10
    },
    {
      path: "notes/two.md",
      markdown: "# Two\n\nBeta paragraph",
      mtime: 20
    }
  ]);
};

describe("indexing progress integration", () => {
  it("emits stage-level progress snapshots in expected order", async () => {
    const harness = createPluginTestHarness();
    seedVault(harness);
    await harness.runOnload();

    const runtime = await harness.ensureRuntimeServices();

    const progressSnapshots: JobSnapshot[] = [];
    await runtime.indexingService.reindexVault({
      onProgress: (snapshot) => {
        progressSnapshots.push(snapshot);
      }
    });

    expect(progressSnapshots.length).toBeGreaterThanOrEqual(5);
    expect(progressSnapshots[0]?.progress.label).toContain("Crawl");
    expect(progressSnapshots[1]?.progress.label).toContain("Chunk");
    expect(progressSnapshots[2]?.progress.label).toContain("Embed");
    expect(progressSnapshots[3]?.progress.label).toContain("Finalize");
    expect(progressSnapshots[progressSnapshots.length - 1]?.status).toBe("succeeded");

    await harness.runOnunload();
  });

  it("blocks duplicate concurrent indexing jobs for both entry points", async () => {
    const harness = createPluginTestHarness();
    seedVault(harness);
    await harness.runOnload();

    const runtime = await harness.ensureRuntimeServices();

    let duplicateReindexError: Error | null = null;
    let duplicateIncrementalError: Error | null = null;
    let launchedDuplicateReindex = false;
    let launchedDuplicateIncremental = false;
    let duplicateReindexPromise: Promise<void> = Promise.resolve();
    let duplicateIncrementalPromise: Promise<void> = Promise.resolve();

    await runtime.indexingService.reindexVault({
      onProgress: () => {
        if (!launchedDuplicateReindex) {
          launchedDuplicateReindex = true;
          duplicateReindexPromise = runtime.indexingService
            .indexChanges()
            .then(() => undefined)
            .catch((error: unknown) => {
              duplicateReindexError = error instanceof Error ? error : new Error(String(error));
            });
        }
      }
    });
    await duplicateReindexPromise;

    await runtime.indexingService.indexChanges({
      onProgress: () => {
        if (!launchedDuplicateIncremental) {
          launchedDuplicateIncremental = true;
          duplicateIncrementalPromise = runtime.indexingService
            .reindexVault()
            .then(() => undefined)
            .catch((error: unknown) => {
              duplicateIncrementalError = error instanceof Error ? error : new Error(String(error));
            });
        }
      }
    });
    await duplicateIncrementalPromise;

    expect(duplicateReindexError).toBeInstanceOf(Error);
    if (!duplicateReindexError) {
      throw new Error("Expected duplicate reindex error.");
    }
    expect(duplicateReindexError.message).toContain("already running");
    expect(duplicateIncrementalError).toBeInstanceOf(Error);
    if (!duplicateIncrementalError) {
      throw new Error("Expected duplicate incremental error.");
    }
    expect(duplicateIncrementalError.message).toContain("already running");

    await harness.runOnunload();
  });
});
