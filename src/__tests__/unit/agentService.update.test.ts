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
    logLevel: "info"
  };
};

interface AgentHarness {
  service: AgentService;
  modifyCalls: Array<{ path: string; content: string }>;
  notifications: string[];
}

const createHarness = (settings: ObsidianAISettings, existingPaths: string[] = []): AgentHarness => {
  const notifications: string[] = [];
  const modifyCalls: Array<{ path: string; content: string }> = [];
  const existing = new Set(existingPaths);
  const app = {
    vault: {
      create: async () => undefined,
      modify: async (file: { path: string }, content: string) => {
        modifyCalls.push({
          path: file.path,
          content
        });
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
    modifyCalls,
    notifications
  };
};

describe("AgentService update note workflow", () => {
  it("A1_blocks_invalid_or_disallowed_paths", async () => {
    const settings = createSettings();
    const harness = createHarness(settings, ["projects/notes/ok.md"]);
    await harness.service.init();

    await harness.service.updateNote("../escape.md", "content");
    await harness.service.updateNote("outside/blocked.md", "content");

    expect(harness.modifyCalls).toHaveLength(0);
    expect(harness.notifications.some((message) => message.includes("invalid path"))).toBe(true);
    expect(harness.notifications.some((message) => message.includes("outside allowed output folders"))).toBe(true);
  });

  it("A2_blocks_oversized_content", async () => {
    const settings = createSettings();
    settings.maxGeneratedNoteSize = 5;
    const harness = createHarness(settings, ["projects/notes/ok.md"]);
    await harness.service.init();

    await harness.service.updateNote("projects/notes/ok.md", "123456");
    expect(harness.modifyCalls).toHaveLength(0);
    expect(harness.notifications[0]).toContain("content exceeds max size");
  });

  it("B1_updates_existing_note", async () => {
    const settings = createSettings();
    const harness = createHarness(settings, ["projects/notes/ok.md"]);
    await harness.service.init();

    await harness.service.updateNote("./projects/notes/ok.md", "updated content");
    expect(harness.modifyCalls).toEqual([
      {
        path: "projects/notes/ok.md",
        content: "updated content"
      }
    ]);
    expect(harness.notifications[0]).toContain("Updated note");
  });

  it("B2_blocks_missing_target", async () => {
    const settings = createSettings();
    const harness = createHarness(settings);
    await harness.service.init();

    await harness.service.updateNote("projects/notes/missing.md", "content");
    expect(harness.modifyCalls).toHaveLength(0);
    expect(harness.notifications[0]).toContain("file does not exist");
  });

  it("B3_disposed_guard", async () => {
    const settings = createSettings();
    const harness = createHarness(settings, ["projects/notes/ok.md"]);
    await harness.service.init();
    await harness.service.dispose();

    await expect(harness.service.updateNote("projects/notes/ok.md", "content")).rejects.toThrow("AgentService is disposed.");
  });
});
