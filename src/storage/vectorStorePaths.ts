import type { LocalVectorStorePaths } from "../types";

const DEFAULT_PLUGIN_ID = "obsidian-ai-mvp";

const sanitizePluginId = (pluginId: string): string => {
  const trimmed = pluginId.trim();
  if (trimmed.length === 0) {
    return DEFAULT_PLUGIN_ID;
  }
  return trimmed.replace(/[^a-z0-9-_]/gi, "-");
};

export const resolveLocalVectorStorePaths = (pluginId: string): LocalVectorStorePaths => {
  const safePluginId = sanitizePluginId(pluginId);
  const rootDir = `.obsidian/plugins/${safePluginId}/storage`;
  return {
    rootDir,
    sqliteDbPath: `${rootDir}/vector-store.sqlite3`,
    migrationsDir: `${rootDir}/migrations`
  };
};
