import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_VIEW_TYPE, COMMAND_IDS, COMMAND_NAMES, SEARCH_VIEW_TYPE } from "../constants";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const sourcePath = (...segments: string[]): string => resolve(CURRENT_DIR, "..", ...segments);
const readSource = (...segments: string[]): string => readFileSync(sourcePath(...segments), "utf8");

describe("plugin shell smoke test", () => {
  it("exposes stable runtime IDs", () => {
    expect(SEARCH_VIEW_TYPE).toBe("obsidian-ai:search-view");
    expect(CHAT_VIEW_TYPE).toBe("obsidian-ai:chat-view");
    expect(COMMAND_IDS.REINDEX_VAULT).toBe("obsidian-ai:reindex-vault");
    expect(COMMAND_IDS.INDEX_CHANGES).toBe("obsidian-ai:index-changes");
    expect(COMMAND_IDS.SEARCH_SELECTION).toBe("obsidian-ai:search-selection");
  });

  it("exposes expected command display names", () => {
    expect(COMMAND_NAMES.REINDEX_VAULT).toBe("Reindex vault");
    expect(COMMAND_NAMES.INDEX_CHANGES).toBe("Index changes");
    expect(COMMAND_NAMES.SEARCH_SELECTION).toBe("Semantic search selection");
  });

  it("registers lifecycle shell surfaces in source", () => {
    const mainSource = readSource("main.ts");
    expect(mainSource.includes("public async onload(): Promise<void>")).toBe(true);
    expect(mainSource.includes("public async onunload(): Promise<void>")).toBe(true);
    expect(mainSource.includes("this.registerView(SEARCH_VIEW_TYPE")).toBe(true);
    expect(mainSource.includes("this.registerView(CHAT_VIEW_TYPE")).toBe(true);
    expect(mainSource.includes("this.addSettingTab(new ObsidianAISettingTab")).toBe(true);
  });

  it("keeps view shell contract methods in source", () => {
    const searchViewSource = readSource("ui", "SearchView.ts");
    const chatViewSource = readSource("ui", "ChatView.ts");
    expect(searchViewSource.includes("public getViewType(): string")).toBe(true);
    expect(searchViewSource.includes("public async onOpen(): Promise<void>")).toBe(true);
    expect(searchViewSource.includes("public async onClose(): Promise<void>")).toBe(true);
    expect(chatViewSource.includes("public getViewType(): string")).toBe(true);
    expect(chatViewSource.includes("public async onOpen(): Promise<void>")).toBe(true);
    expect(chatViewSource.includes("public async onClose(): Promise<void>")).toBe(true);
  });

  it("keeps non-secret defaults in settings source", () => {
    const settingsSource = readSource("settings.ts");
    expect(settingsSource.includes("export const DEFAULT_SETTINGS")).toBe(true);
    expect(settingsSource.includes("embeddingProvider: \"openai\"")).toBe(true);
    expect(settingsSource.includes("chatProvider: \"openai\"")).toBe(true);
    expect(settingsSource.includes("indexedFolders: [\"/\"]")).toBe(true);
    expect(settingsSource.includes("openai-api-key")).toBe(false);
  });
});
