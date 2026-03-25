import { describe, expect, it } from "vitest";
import { SETTINGS_SCHEMA_VERSION } from "../../settingsSchema";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

describe("plugin settings integration", () => {
  it("loads legacy top-level settings and applies migration defaults", async () => {
    const harness = createPluginTestHarness();
    await harness.plugin.saveData({
      embeddingProvider: "invalid-provider",
      indexedPaths: "notes, projects",
      timeoutMs: 45000,
      settingsVersion: 0
    });

    await harness.runOnload();

    expect(harness.plugin.settings.embeddingProvider).toBe("openai");
    expect(harness.plugin.settings.indexedFolders).toEqual(["notes", "projects"]);
    expect(harness.plugin.settings.chatTimeout).toBe(45000);

    await harness.runOnunload();
  });

  it("saves settings into versioned envelope without dropping index state", async () => {
    const harness = createPluginTestHarness();
    await harness.plugin.saveData({
      indexManifest: {
        version: 1,
        updatedAt: 100,
        notes: []
      },
      indexJobState: {
        activeJob: null,
        lastCompletedJob: null,
        history: []
      }
    });

    await harness.runOnload();

    harness.plugin.settings.chatTimeout = 42000;
    harness.plugin.settings.excludedFolders = ["archive"];
    harness.plugin.settings.logLevel = "debug";
    await harness.plugin.saveSettings();

    const persisted = await harness.plugin.loadData();
    expect(isRecord(persisted)).toBe(true);
    if (!isRecord(persisted)) {
      throw new Error("Expected persisted plugin data record.");
    }

    expect(isRecord(persisted.indexManifest)).toBe(true);
    expect(isRecord(persisted.indexJobState)).toBe(true);
    expect(isRecord(persisted.settings)).toBe(true);

    const persistedSettings = persisted.settings;
    if (!isRecord(persistedSettings)) {
      throw new Error("Expected persisted settings payload.");
    }

    expect(persistedSettings.settingsVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(persistedSettings.chatTimeout).toBe(42000);
    expect(persistedSettings.excludedFolders).toEqual(["archive"]);
    expect(persistedSettings.logLevel).toBe("debug");

    await harness.runOnunload();
  });

  it("persists per_vault_vectorStoreAbsolutePath_in_settings_envelope", async () => {
    const harness = createPluginTestHarness();
    await harness.runOnload();

    harness.plugin.settings.vectorStoreAbsolutePath = "/tmp/obsidian-ai-test.sqlite3";
    await harness.plugin.saveSettings();

    const persisted = await harness.plugin.loadData();
    expect(isRecord(persisted)).toBe(true);
    if (!isRecord(persisted) || !isRecord(persisted.settings)) {
      throw new Error("Expected persisted settings envelope.");
    }
    expect(persisted.settings.vectorStoreAbsolutePath).toBe("/tmp/obsidian-ai-test.sqlite3");
    expect(persisted.settings.settingsVersion).toBe(SETTINGS_SCHEMA_VERSION);

    await harness.runOnunload();
  });
});
