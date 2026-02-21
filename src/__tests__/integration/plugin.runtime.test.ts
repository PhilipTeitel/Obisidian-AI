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
  it("loads runtime shell surfaces and disposes runtime services on unload", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    const registeredCommandIds = harness
      .getRegisteredCommands()
      .map((command) => command.id)
      .sort();

    expect(registeredCommandIds).toEqual([
      COMMAND_IDS.INDEX_CHANGES,
      COMMAND_IDS.REINDEX_VAULT,
      COMMAND_IDS.SEARCH_SELECTION
    ]);

    expect(harness.getRegisteredViews().map((view) => view.type).sort()).toEqual([
      "obsidian-ai:chat-view",
      "obsidian-ai:search-view"
    ]);
    expect(harness.getSettingTabCount()).toBe(1);

    const runtimeServices = harness.getRuntimeServices();
    if (!runtimeServices) {
      throw new Error("Expected runtime services after onload.");
    }

    await harness.runOnunload();

    const providerRegistry = runtimeServices.providerRegistry as unknown as ProviderRegistryInspectable;
    expect(providerRegistry.isDisposed()).toBe(true);
  });

  it("runs reindex and index-changes commands through registered callbacks", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);
    await harness.invokeCommand(COMMAND_IDS.INDEX_CHANGES);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices).toContain("Reindex vault is not implemented in FND-4 yet.");
    expect(notices).toContain("Index changes is not implemented in FND-4 yet.");

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
    expect(notices).toContain("Semantic search selection is not implemented in FND-4 yet.");
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(1);

    await harness.runOnunload();
  });

  it("normalizes command failure path and marks progress snapshot as failed", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    harness.setRuntimeServices(null);
    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices).toContain("Unexpected runtime error. Retry the action and check console logs for details.");

    const pluginProgress = harness.plugin as unknown as PluginProgressState;
    expect(pluginProgress.progressSlideout?.containerEl.dataset.state).toBe("failed");

    await harness.runOnunload();
  });
});
