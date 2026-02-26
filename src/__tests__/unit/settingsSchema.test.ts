import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings";
import {
  SETTINGS_SCHEMA_VERSION,
  migratePersistedSettings,
  normalizeSettingsSnapshot,
  serializeSettingsForPersistence
} from "../../settingsSchema";

describe("settingsSchema", () => {
  it("normalizes invalid and empty values using defaults", () => {
    const normalized = normalizeSettingsSnapshot(
      {
        embeddingProvider: "unknown-provider",
        chatProvider: "also-unknown",
        embeddingModel: "   ",
        chatModel: " ",
        openaiEndpoint: "https://example.test/v1///",
        ollamaEndpoint: "",
        indexedFolders: "notes, notes, projects" as unknown as string[],
        excludedFolders: ["archive", "archive", " "],
        agentOutputFolders: [],
        maxGeneratedNoteSize: -1,
        chatTimeout: 0,
        logLevel: "trace" as unknown as "debug"
      },
      DEFAULT_SETTINGS
    );

    expect(normalized.embeddingProvider).toBe(DEFAULT_SETTINGS.embeddingProvider);
    expect(normalized.chatProvider).toBe(DEFAULT_SETTINGS.chatProvider);
    expect(normalized.embeddingModel).toBe(DEFAULT_SETTINGS.embeddingModel);
    expect(normalized.chatModel).toBe(DEFAULT_SETTINGS.chatModel);
    expect(normalized.openaiEndpoint).toBe("https://example.test/v1");
    expect(normalized.ollamaEndpoint).toBe(DEFAULT_SETTINGS.ollamaEndpoint);
    expect(normalized.indexedFolders).toEqual(["notes", "projects"]);
    expect(normalized.excludedFolders).toEqual(["archive"]);
    expect(normalized.agentOutputFolders).toEqual(DEFAULT_SETTINGS.agentOutputFolders);
    expect(normalized.maxGeneratedNoteSize).toBe(DEFAULT_SETTINGS.maxGeneratedNoteSize);
    expect(normalized.chatTimeout).toBe(DEFAULT_SETTINGS.chatTimeout);
    expect(normalized.logLevel).toBe(DEFAULT_SETTINGS.logLevel);
  });

  it("migrates legacy top-level settings keys to current shape", () => {
    const migrated = migratePersistedSettings({
      settingsVersion: 0,
      indexedPaths: "notes, projects",
      writeFolders: ["agent", "agent", " "],
      timeoutMs: 45000
    });

    expect(migrated.settingsVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrated.indexedFolders).toEqual(["notes", "projects"]);
    expect(migrated.agentOutputFolders).toEqual(["agent"]);
    expect(migrated.chatTimeout).toBe(45000);
  });

  it("serializes runtime settings with schema version", () => {
    const serialized = serializeSettingsForPersistence(DEFAULT_SETTINGS);
    expect(serialized.settingsVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(serialized.embeddingProvider).toBe("openai");
    expect(serialized.chatTimeout).toBe(30000);
    expect(serialized.logLevel).toBe("info");
  });

  it("A3_log_level_normalization_and_persistence", () => {
    const normalized = normalizeSettingsSnapshot(
      {
        logLevel: "debug"
      },
      DEFAULT_SETTINGS
    );
    expect(normalized.logLevel).toBe("debug");

    const persisted = serializeSettingsForPersistence(normalized);
    expect(persisted.logLevel).toBe("debug");
  });
});
