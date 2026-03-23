import { describe, expect, it } from "vitest";
import { AgentService } from "../../services/AgentService";
import type { ObsidianAISettings, RuntimeBootstrapContext } from "../../types";

const createSettings = (): ObsidianAISettings => {
  return {
    embeddingProvider: "openai",
    chatProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    chatModel: "gpt-4o-mini",
    ollamaEndpoint: "http://localhost:11434",
    openaiEndpoint: "https://api.openai.com/v1",
    indexedFolders: ["/"],
    excludedFolders: [],
    agentOutputFolders: ["projects/notes"],
    maxGeneratedNoteSize: 5000,
    chatTimeout: 30000,
    logLevel: "info",
    summaryMaxTokens: 100,
    matchedContentBudget: 2000,
    siblingContextBudget: 1000,
    parentSummaryBudget: 1000
  };
};

interface AgentHarness {
  service: AgentService;
  createCalls: Array<{ path: string; content: string }>;
  notifications: string[];
}

const createHarness = (settings: ObsidianAISettings, existingPaths: string[] = []): AgentHarness => {
  const createCalls: Array<{ path: string; content: string }> = [];
  const notifications: string[] = [];
  const existing = new Set(existingPaths);
  const app = {
    vault: {
      create: async (path: string, content: string) => {
        createCalls.push({ path, content });
      },
      getAbstractFileByPath: (path: string) => {
        return existing.has(path) ? { path } : null;
      }
    }
  } as RuntimeBootstrapContext["app"];

  return {
    service: new AgentService({
      app,
      getSettings: () => settings,
      notify: (message) => {
        notifications.push(message);
      }
    }),
    createCalls,
    notifications
  };
};

describe("AgentService create note workflow", () => {
  it("A1_blocks_disallowed_paths", async () => {
    const settings = createSettings();
    const harness = createHarness(settings);
    await harness.service.init();

    await harness.service.createNote("outside/note.md", "content");
    await harness.service.createNote("../escape.md", "content");

    settings.agentOutputFolders = [];
    await harness.service.createNote("projects/notes/allowed.md", "content");

    expect(harness.createCalls).toHaveLength(0);
    expect(harness.notifications.some((message) => message.includes("outside allowed output folders"))).toBe(true);
    expect(harness.notifications.some((message) => message.includes("invalid path"))).toBe(true);
  });

  it("A2_blocks_oversized_content", async () => {
    const settings = createSettings();
    settings.maxGeneratedNoteSize = 5;
    const harness = createHarness(settings);
    await harness.service.init();

    await harness.service.createNote("projects/notes/too-large.md", "123456");
    expect(harness.createCalls).toHaveLength(0);
    expect(harness.notifications[0]).toContain("content exceeds max size");
  });

  it("B1_creates_note_in_allowed_folder", async () => {
    const settings = createSettings();
    const harness = createHarness(settings);
    await harness.service.init();

    await harness.service.createNote("./projects/notes/new-note.md", "new content");
    expect(harness.createCalls).toEqual([
      {
        path: "projects/notes/new-note.md",
        content: "new content"
      }
    ]);
    expect(harness.notifications[0]).toContain("Created note");
  });

  it("B2_blocks_when_target_exists", async () => {
    const settings = createSettings();
    const harness = createHarness(settings, ["projects/notes/existing.md"]);
    await harness.service.init();

    await harness.service.createNote("projects/notes/existing.md", "content");
    expect(harness.createCalls).toHaveLength(0);
    expect(harness.notifications[0]).toContain("file already exists");
  });

  it("B3_disposed_guard", async () => {
    const settings = createSettings();
    const harness = createHarness(settings);
    await harness.service.init();
    await harness.service.dispose();

    await expect(harness.service.createNote("projects/notes/fail.md", "content")).rejects.toThrow("AgentService is disposed.");
  });
});
