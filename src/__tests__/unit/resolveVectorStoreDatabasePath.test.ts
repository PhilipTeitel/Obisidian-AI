import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn((): string => "/Users/posix-user"));

vi.mock("os", () => ({
  homedir: (): string => mockHomedir()
}));

import {
  defaultVectorStoreFilename,
  isAbsoluteVectorStorePath,
  resolveVectorStoreDatabasePath,
  sanitizeVaultNameForFilename
} from "../../storage/resolveVectorStoreDatabasePath";

describe("resolveVectorStoreDatabasePath", () => {
  beforeEach(() => {
    mockHomedir.mockReturnValue("/Users/posix-user");
  });

  it("A1_default_path_uses_homedir_obsidian_ai_and_sanitized_vault_name", () => {
    const resolved = resolveVectorStoreDatabasePath({
      vaultName: "My Notes Vault",
      vaultPath: "/vaults/my-notes"
    });
    expect(resolved).toBe("/Users/posix-user/.obsidian-ai/vector-store.My Notes Vault.sqlite3");
  });

  it("A1_strips_unsafe_characters_in_vault_name", () => {
    const resolved = resolveVectorStoreDatabasePath({
      vaultName: 'foo/bar:baz*"<>|',
      vaultPath: "/x"
    });
    expect(resolved).toBe("/Users/posix-user/.obsidian-ai/vector-store.foo-bar-baz.sqlite3");
  });

  it("A3_empty_after_sanitize_uses_stable_hash_segment_from_vaultPath", () => {
    const pathA = resolveVectorStoreDatabasePath({
      vaultName: "...   ",
      vaultPath: "/unique/vault/a"
    });
    const pathB = resolveVectorStoreDatabasePath({
      vaultName: "///",
      vaultPath: "/unique/vault/a"
    });
    const pathOther = resolveVectorStoreDatabasePath({
      vaultName: "...   ",
      vaultPath: "/unique/vault/b"
    });
    expect(pathA).toBe(pathB);
    expect(pathA).toMatch(/^\/Users\/posix-user\/\.obsidian-ai\/vector-store\.h[0-9a-f]{16}\.sqlite3$/);
    expect(pathA).not.toBe(pathOther);
  });

  it("B1_non_empty_override_returns_trimmed_absolute_path", () => {
    const resolved = resolveVectorStoreDatabasePath({
      vaultName: "Ignored",
      vaultPath: "/ignored",
      vectorStoreAbsolutePathOverride: "  /tmp/custom.sqlite3  "
    });
    expect(resolved).toBe("/tmp/custom.sqlite3");
  });

  it("POSIX_style_homedir_mock_joins_default_file", () => {
    mockHomedir.mockReturnValue("/home/dev");
    expect(
      resolveVectorStoreDatabasePath({
        vaultName: "Work",
        vaultPath: "/path/to/work"
      })
    ).toBe("/home/dev/.obsidian-ai/vector-store.Work.sqlite3");
  });

  it("Windows_style_homedir_mock_produces_obsidian_ai_segment", () => {
    mockHomedir.mockReturnValue("C:\\Users\\tester");
    const resolved = resolveVectorStoreDatabasePath({
      vaultName: "WinVault",
      vaultPath: "D:\\vault"
    });
    expect(resolved).toContain("vector-store.WinVault.sqlite3");
    expect(resolved).toMatch(/C:[/\\]Users[/\\]tester[/\\]\.obsidian-ai[/\\]/);
  });
});

describe("sanitizeVaultNameForFilename", () => {
  it("preserves_unicode_letters", () => {
    expect(sanitizeVaultNameForFilename("日本語")).toBe("日本語");
  });
});

describe("defaultVectorStoreFilename", () => {
  it("uses_hash_when_name_sanitizes_to_empty", () => {
    const name = defaultVectorStoreFilename("   ... ", "/stable/path");
    expect(name).toMatch(/^vector-store\.h[0-9a-f]{16}\.sqlite3$/);
  });
});

describe("isAbsoluteVectorStorePath", () => {
  it("accepts_posix_absolute", () => {
    expect(isAbsoluteVectorStorePath("/var/store.sqlite3")).toBe(true);
  });

  it("rejects_relative", () => {
    expect(isAbsoluteVectorStorePath("relative/store.sqlite3")).toBe(false);
    expect(isAbsoluteVectorStorePath("./here.sqlite3")).toBe(false);
  });
});
