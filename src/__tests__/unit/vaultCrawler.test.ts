import { describe, expect, it } from "vitest";
import {
  crawlVaultMarkdownNotes,
  isPathInFolderScope,
  normalizeVaultFolderPath,
  type VaultLike,
  type VaultMarkdownFileLike
} from "../../utils/vaultCrawler";

interface MockVaultResult {
  vault: VaultLike;
  reads: string[];
}

const createMockVault = (files: VaultMarkdownFileLike[], contentByPath: Record<string, string>): MockVaultResult => {
  const reads: string[] = [];
  return {
    reads,
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file) => {
        reads.push(file.path);
        return contentByPath[file.path] ?? "";
      }
    }
  };
};

describe("vaultCrawler", () => {
  it("normalizes include/exclude paths and gives exclude precedence", async () => {
    const files: VaultMarkdownFileLike[] = [
      { path: "projects/plan.md", basename: "plan", stat: { mtime: 11 } },
      { path: "projects/archive/old.md", basename: "old", stat: { mtime: 10 } },
      { path: "notes/research/idea.md", basename: "idea", stat: { mtime: 12 } },
      { path: "notes/private/secret.md", basename: "secret", stat: { mtime: 13 } }
    ];
    const { vault, reads } = createMockVault(files, {
      "projects/plan.md": "Project plan",
      "projects/archive/old.md": "Archived note",
      "notes/research/idea.md": "Research idea",
      "notes/private/secret.md": "Secret note"
    });

    const notes = await crawlVaultMarkdownNotes({
      vault,
      indexedFolders: ["/projects/", "notes/research"],
      excludedFolders: ["projects/archive/", "/notes/private/"]
    });

    expect(notes.map((note) => note.notePath)).toEqual(["notes/research/idea.md", "projects/plan.md"]);
    expect(reads).toEqual(["notes/research/idea.md", "projects/plan.md"]);
  });

  it("falls back to root scope when include folders are blank", async () => {
    const files: VaultMarkdownFileLike[] = [
      { path: "notes/daily.md", basename: "daily", stat: { mtime: 101 } },
      { path: "templates/base.md", basename: "base", stat: { mtime: 102 } }
    ];
    const { vault } = createMockVault(files, {
      "notes/daily.md": "Daily note body",
      "templates/base.md": "Template body"
    });

    const notes = await crawlVaultMarkdownNotes({
      vault,
      indexedFolders: ["", "   "],
      excludedFolders: ["/templates/"]
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      notePath: "notes/daily.md",
      noteTitle: "daily",
      markdown: "Daily note body",
      updatedAt: 101
    });
  });

  it("returns deterministic note order regardless vault file enumeration order", async () => {
    const files: VaultMarkdownFileLike[] = [
      { path: "z-folder/z.md", basename: "z", stat: { mtime: 3 } },
      { path: "a-folder/a.md", basename: "a", stat: { mtime: 1 } },
      { path: "/m-folder/m.md", basename: "m", stat: { mtime: 2 } }
    ];
    const { vault } = createMockVault(files, {
      "z-folder/z.md": "z-body",
      "a-folder/a.md": "a-body",
      "/m-folder/m.md": "m-body"
    });

    const notes = await crawlVaultMarkdownNotes({
      vault,
      indexedFolders: ["/"],
      excludedFolders: []
    });

    expect(notes.map((note) => note.notePath)).toEqual(["a-folder/a.md", "m-folder/m.md", "z-folder/z.md"]);
    expect(notes.map((note) => note.markdown)).toEqual(["a-body", "m-body", "z-body"]);
  });

  it("provides boundary-safe folder matching helpers", () => {
    expect(normalizeVaultFolderPath(" /projects/ ")).toBe("projects");
    expect(normalizeVaultFolderPath("/")).toBeNull();
    expect(isPathInFolderScope("project-notes/plan.md", "proj")).toBe(false);
    expect(isPathInFolderScope("projects/plan.md", "projects")).toBe(true);
    expect(isPathInFolderScope("anything.md", "/")).toBe(true);
  });
});
