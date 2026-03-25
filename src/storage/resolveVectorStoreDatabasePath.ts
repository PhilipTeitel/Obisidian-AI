import { createHash } from "crypto";
import { homedir } from "os";
import path from "path";

const OBSIDIAN_AI_DIR = ".obsidian-ai";
const VECTOR_STORE_FILENAME_PREFIX = "vector-store.";
const MAX_VAULT_NAME_SEGMENT_LENGTH = 120;

const replaceAsciiControlChars = (value: string): string => {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code <= 31 ? "-" : value[i];
  }
  return out;
};

/**
 * When `sanitizeVaultNameForFilename` yields an empty string, the default DB file name uses a
 * stable segment derived from SHA-256(UTF-8 vaultPath), e.g. `vector-store.h<16 hex>.sqlite3`.
 * Two different vault paths therefore do not collide silently when vault names sanitize to empty.
 */
const hashFallbackSegment = (vaultPath: string): string => {
  const digest = createHash("sha256").update(vaultPath, "utf8").digest("hex").slice(0, 16);
  return `h${digest}`;
};

/**
 * Normalizes Obsidian’s vault name to a single filesystem path segment (§2.2 prompt 05).
 * Strips/replaces characters unsafe on common desktop filesystems. Empty-after-sanitize falls
 * back to `hashFallbackSegment` at compose time, not here.
 * Two different vaults with the same sanitized name would map to the same default file; use the
 * per-vault absolute path override or rename a vault to disambiguate.
 */
export const sanitizeVaultNameForFilename = (vaultName: string): string => {
  let segment = vaultName.normalize("NFKC").trim();
  segment = replaceAsciiControlChars(segment);
  segment = segment.replace(/[/\\:*?"<>|]/g, "-");
  segment = segment.replace(/-+/g, "-");
  segment = segment.replace(/^[\s.-]+|[\s.-]+$/g, "");
  if (segment.length > MAX_VAULT_NAME_SEGMENT_LENGTH) {
    segment = segment.slice(0, MAX_VAULT_NAME_SEGMENT_LENGTH).replace(/[\s.-]+$/g, "");
  }
  return segment;
};

export const defaultVectorStoreFilename = (vaultName: string, vaultPath: string): string => {
  const sanitized = sanitizeVaultNameForFilename(vaultName);
  const middle = sanitized.length > 0 ? sanitized : hashFallbackSegment(vaultPath);
  return `${VECTOR_STORE_FILENAME_PREFIX}${middle}.sqlite3`;
};

export interface ResolveVectorStorePathInput {
  vaultName: string;
  vaultPath: string;
  vectorStoreAbsolutePathOverride?: string | undefined;
}

/**
 * Resolves the absolute path to this vault’s SQLite vector store file.
 * Uses `os.homedir()` for the default parent directory (no `~` expansion).
 */
export const resolveVectorStoreDatabasePath = (input: ResolveVectorStorePathInput): string => {
  const override = input.vectorStoreAbsolutePathOverride?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const parent = path.join(homedir(), OBSIDIAN_AI_DIR);
  return path.join(parent, defaultVectorStoreFilename(input.vaultName, input.vaultPath));
};

/** True when the trimmed override is an absolute path on the current platform (POSIX vs Windows). */
export const isAbsoluteVectorStorePath = (value: string): boolean => path.isAbsolute(value.trim());
