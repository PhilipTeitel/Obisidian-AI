import { describe, expect, it } from "vitest";
import { COMMAND_IDS, SEARCH_VIEW_TYPE } from "../../constants";
import type { RuntimeLogContext } from "../../types";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";

interface ProviderRegistryInspectable {
  isDisposed: () => boolean;
}

interface ProgressSlideoutInspectable {
  containerEl: {
    dataset: RuntimeLogContext;
  };
}

interface PluginProgressState {
  progressSlideout: ProgressSlideoutInspectable | null;
}

describe("plugin runtime integration", () => {
  it("loads runtime shell surfaces, lazily bootstraps runtime services, and disposes on unload", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    const registeredCommandIds = harness
      .getRegisteredCommands()
      .map((command) => command.id)
      .sort();

    expect(registeredCommandIds).toEqual([
      COMMAND_IDS.INDEX_CHANGES,
      COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE,
      COMMAND_IDS.REINDEX_VAULT,
      COMMAND_IDS.SEARCH_SELECTION
    ]);

    expect(harness.getRegisteredViews().map((view) => view.type).sort()).toEqual([
      "obsidian-ai:chat-view",
      "obsidian-ai:search-view"
    ]);
    expect(harness.getSettingTabCount()).toBe(1);
    expect(harness.getRuntimeServices()).toBeNull();

    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);

    const runtimeServices = harness.getRuntimeServices();
    if (!runtimeServices) {
      throw new Error("Expected runtime services after first runtime command.");
    }

    await harness.runOnunload();

    const providerRegistry = runtimeServices.providerRegistry as unknown as ProviderRegistryInspectable;
    expect(providerRegistry.isDisposed()).toBe(true);
  });

  it("runs reindex and index-changes commands through registered callbacks", async () => {
    const harness = createPluginTestHarness();
    harness.appHarness.setVaultMarkdownFiles([
      {
        path: "notes/runtime.md",
        markdown: "# Runtime\n\nIndexed note",
        mtime: 1
      }
    ]);
    await harness.runOnload();

    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);
    await harness.invokeCommand(COMMAND_IDS.INDEX_CHANGES);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices.some((message) => message.startsWith("Reindex vault completed."))).toBe(true);
    expect(notices.some((message) => message.startsWith("Index changes completed."))).toBe(true);
    expect(notices.some((message) => message.includes("not implemented in FND-4"))).toBe(false);

    await harness.runOnunload();
  });

  it("recovers stale indexing state before running index-changes", async () => {
    const harness = createPluginTestHarness();
    harness.appHarness.setVaultMarkdownFiles([
      {
        path: "notes/recovery.md",
        markdown: "# Recovery\n\nRun after stale state",
        mtime: 1
      }
    ]);
    await harness.plugin.saveData({
      indexManifest: {
        version: 1,
        notes: "broken"
      },
      indexJobState: {
        activeJob: {
          id: "stale-job",
          type: "index-changes",
          status: "running",
          startedAt: 1,
          progress: {
            completed: 0,
            total: 1,
            label: "Index changes · Crawl",
            detail: "Stale"
          }
        },
        history: []
      }
    });

    await harness.runOnload();
    await harness.invokeCommand(COMMAND_IDS.INDEX_CHANGES);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices.some((message) => message.startsWith("Index changes completed."))).toBe(true);
    expect(notices.some((message) => message.includes("Recovery:"))).toBe(true);

    await harness.runOnunload();
  });

  it("handles semantic search selection command for empty and populated selections", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    harness.appHarness.clearSelection();
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);
    expect(harness.appHarness.getNoticeMessages()).toContain(
      "Select note text before running Semantic search selection."
    );

    harness.appHarness.setSelection("Find related references in this paragraph.");
    await harness.invokeCommand(COMMAND_IDS.SEARCH_SELECTION);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices.some((message) => message.includes("not implemented"))).toBe(false);
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(1);

    await harness.runOnunload();
  });

  it("opens semantic search pane without bootstrapping runtime services", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    expect(harness.getRuntimeServices()).toBeNull();

    await harness.invokeCommand(COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE);
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(1);
    expect(harness.getRuntimeServices()).toBeNull();

    await harness.invokeCommand(COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE);
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(2);
    expect(harness.getRuntimeServices()).toBeNull();

    await harness.runOnunload();
  });

  it("normalizes command failure path and marks progress snapshot as failed", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();
    const runtimeServices = await harness.ensureRuntimeServices();

    runtimeServices.indexingService.reindexVault = async () => {
      throw new Error("forced runtime command failure");
    };
    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices).toContain("Unexpected runtime error. Retry the action and check console logs for details.");

    const pluginProgress = harness.plugin as unknown as PluginProgressState;
    expect(pluginProgress.progressSlideout?.containerEl.dataset.state).toBe("failed");

    await harness.runOnunload();
  });

  it("appends recovery action hints to user notices on indexing failures", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();
    const runtimeServices = await harness.ensureRuntimeServices();

    runtimeServices.indexingService.reindexVault = async () => {
      throw new Error("Provider timeout. Recovery action: Check provider endpoint/API key and retry the indexing command.");
    };

    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices.some((message) => message.includes("Recovery action: Check provider endpoint/API key"))).toBe(true);

    await harness.runOnunload();
  });
});
