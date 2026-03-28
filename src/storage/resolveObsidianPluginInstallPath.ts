import path from "path";
import type { App } from "obsidian";
import { getVaultVectorStoreContext } from "../settings";

/**
 * Absolute filesystem directory where Obsidian loaded this plugin (`main.js` lives here).
 *
 * `Vault.configDir` is often the **relative** segment `.obsidian` (see Obsidian API), not a full
 * path. Joining it without the vault root yields URLs like `file:///.obsidian/plugins/...` when
 * `pathToFileURL` resolves against a cwd of `/`, which breaks dynamic `import()` of WASM glue.
 */
export const resolveObsidianPluginInstallPath = (app: App, pluginId: string): string => {
  const configDir = app.vault.configDir;
  const pluginsSegment = path.join("plugins", pluginId);
  if (path.isAbsolute(configDir)) {
    return path.join(configDir, pluginsSegment);
  }
  const { vaultPath } = getVaultVectorStoreContext(app);
  return path.join(vaultPath, configDir, pluginsSegment);
};
