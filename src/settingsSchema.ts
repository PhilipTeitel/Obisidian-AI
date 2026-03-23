import { MVP_PROVIDER_IDS, type ObsidianAISettings } from "./types";

export const SETTINGS_SCHEMA_VERSION = 1;

export interface PersistedSettingsData extends Partial<ObsidianAISettings> {
  settingsVersion?: number;
  indexedPaths?: unknown;
  writeFolders?: unknown;
  timeoutMs?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const toPositiveInteger = (value: unknown, fallback: number, min = 1): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const integer = Math.floor(parsed);
  if (integer < min) {
    return fallback;
  }
  return integer;
};

const normalizeEndpoint = (value: unknown, fallback: string): string => {
  const candidate = toTrimmedString(value) ?? fallback;
  return candidate.replace(/\/+$/, "");
};

const normalizeProviderId = (value: unknown, fallback: ObsidianAISettings["embeddingProvider"]): ObsidianAISettings["embeddingProvider"] => {
  if (typeof value === "string" && MVP_PROVIDER_IDS.includes(value as (typeof MVP_PROVIDER_IDS)[number])) {
    return value;
  }
  return fallback;
};

const isLogLevel = (value: unknown): value is ObsidianAISettings["logLevel"] => {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
};

const normalizeLogLevel = (
  value: unknown,
  fallback: ObsidianAISettings["logLevel"]
): ObsidianAISettings["logLevel"] => {
  return isLogLevel(value) ? value : fallback;
};

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }
  return normalized;
};

const parseFolderInput = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

const normalizeFolders = (value: unknown, fallback: string[]): string[] => {
  const normalized = uniqueStrings(parseFolderInput(value));
  return normalized.length > 0 ? normalized : [...fallback];
};

export const migratePersistedSettings = (input: unknown): PersistedSettingsData => {
  if (!isRecord(input)) {
    return { settingsVersion: SETTINGS_SCHEMA_VERSION };
  }

  const migrated: PersistedSettingsData = { ...input } as PersistedSettingsData;
  const rawVersion = input.settingsVersion;
  const version = typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : 0;

  if (version < 1) {
    if (migrated.indexedFolders === undefined && input.indexedPaths !== undefined) {
      migrated.indexedFolders = uniqueStrings(parseFolderInput(input.indexedPaths));
    }
    if (migrated.agentOutputFolders === undefined && input.writeFolders !== undefined) {
      migrated.agentOutputFolders = uniqueStrings(parseFolderInput(input.writeFolders));
    }
    if (migrated.chatTimeout === undefined && input.timeoutMs !== undefined) {
      migrated.chatTimeout = input.timeoutMs as number;
    }
  }

  migrated.settingsVersion = SETTINGS_SCHEMA_VERSION;
  return migrated;
};

export const normalizeSettingsSnapshot = (
  input: Partial<ObsidianAISettings> | null | undefined,
  defaults: ObsidianAISettings
): ObsidianAISettings => {
  const source = input ?? {};

  const embeddingModel = toTrimmedString(source.embeddingModel) ?? defaults.embeddingModel;
  const chatModel = toTrimmedString(source.chatModel) ?? defaults.chatModel;

  return {
    embeddingProvider: normalizeProviderId(source.embeddingProvider, defaults.embeddingProvider),
    chatProvider: normalizeProviderId(source.chatProvider, defaults.chatProvider),
    embeddingModel,
    chatModel,
    ollamaEndpoint: normalizeEndpoint(source.ollamaEndpoint, defaults.ollamaEndpoint),
    openaiEndpoint: normalizeEndpoint(source.openaiEndpoint, defaults.openaiEndpoint),
    indexedFolders: normalizeFolders(source.indexedFolders, defaults.indexedFolders),
    excludedFolders: normalizeFolders(source.excludedFolders, defaults.excludedFolders),
    agentOutputFolders: normalizeFolders(source.agentOutputFolders, defaults.agentOutputFolders),
    maxGeneratedNoteSize: toPositiveInteger(source.maxGeneratedNoteSize, defaults.maxGeneratedNoteSize),
    chatTimeout: toPositiveInteger(source.chatTimeout, defaults.chatTimeout, 1000),
    logLevel: normalizeLogLevel(source.logLevel, defaults.logLevel),
    summaryMaxTokens: toPositiveInteger(source.summaryMaxTokens, defaults.summaryMaxTokens),
    matchedContentBudget: toPositiveInteger(source.matchedContentBudget, defaults.matchedContentBudget),
    siblingContextBudget: toPositiveInteger(source.siblingContextBudget, defaults.siblingContextBudget),
    parentSummaryBudget: toPositiveInteger(source.parentSummaryBudget, defaults.parentSummaryBudget)
  };
};

export const serializeSettingsForPersistence = (
  settings: ObsidianAISettings
): ObsidianAISettings & { settingsVersion: number } => {
  return {
    ...settings,
    settingsVersion: SETTINGS_SCHEMA_VERSION
  };
};
