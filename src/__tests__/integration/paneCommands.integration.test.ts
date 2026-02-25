import { describe, expect, it } from "vitest";
import { CHAT_VIEW_TYPE, COMMAND_IDS, SEARCH_VIEW_TYPE } from "../../constants";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";

describe("pane commands integration", () => {
  it("A1_pane_commands_are_discoverable", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    const registeredCommandIds = harness.getRegisteredCommands().map((command) => command.id);
    expect(registeredCommandIds).toEqual(
      expect.arrayContaining([COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE, COMMAND_IDS.OPEN_CHAT_PANE])
    );

    await harness.runOnunload();
  });

  it("B1_open_semantic_search_pane_create_then_reuse", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    await harness.invokeCommand(COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE);
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(1);

    await harness.invokeCommand(COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE);
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(2);

    await harness.runOnunload();
  });

  it("B2_open_chat_pane_create_then_reuse", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    await harness.invokeCommand(COMMAND_IDS.OPEN_CHAT_PANE);
    expect(harness.appHarness.getLeavesForType(CHAT_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(1);

    await harness.invokeCommand(COMMAND_IDS.OPEN_CHAT_PANE);
    expect(harness.appHarness.getLeavesForType(CHAT_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getRevealedLeaves()).toHaveLength(2);

    await harness.runOnunload();
  });

  it("B3_pane_open_commands_keep_runtime_lazy", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    expect(harness.getRuntimeServices()).toBeNull();

    await harness.invokeCommand(COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE);
    await harness.invokeCommand(COMMAND_IDS.OPEN_CHAT_PANE);

    expect(harness.getRuntimeServices()).toBeNull();
    expect(harness.appHarness.getLeavesForType(SEARCH_VIEW_TYPE)).toHaveLength(1);
    expect(harness.appHarness.getLeavesForType(CHAT_VIEW_TYPE)).toHaveLength(1);

    await harness.runOnunload();
  });
});
