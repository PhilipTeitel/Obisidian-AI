import path from "path";
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { resolveObsidianPluginInstallPath } from "../../storage/resolveObsidianPluginInstallPath";

describe("resolveObsidianPluginInstallPath", () => {
  it("uses vault base when configDir is relative (.obsidian)", () => {
    const app = {
      vault: {
        configDir: ".obsidian",
        getName: () => "Notes",
        adapter: { getBasePath: () => "/Users/me/MyVault" }
      }
    } as unknown as App;
    expect(resolveObsidianPluginInstallPath(app, "obsidian-ai-mvp")).toBe(
      path.join("/Users/me/MyVault", ".obsidian", "plugins", "obsidian-ai-mvp")
    );
  });

  it("joins plugins under absolute configDir", () => {
    const app = {
      vault: {
        configDir: "/data/vault/.obsidian",
        getName: () => "V"
      }
    } as unknown as App;
    expect(resolveObsidianPluginInstallPath(app, "obsidian-ai-mvp")).toBe(
      path.join("/data/vault/.obsidian", "plugins", "obsidian-ai-mvp")
    );
  });

  it("falls back to getRoot().path when adapter has no base path", () => {
    const app = {
      vault: {
        configDir: ".obsidian",
        getName: () => "N",
        adapter: {},
        getRoot: () => ({ path: "/fallback/vault" })
      }
    } as unknown as App;
    expect(resolveObsidianPluginInstallPath(app, "p")).toBe(
      path.join("/fallback/vault", ".obsidian", "plugins", "p")
    );
  });
});
