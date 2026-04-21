import { showAiNotice } from '../ui/showAiNotice.js';
import type ObsidianAIPlugin from '../main.js';
import { getOpenAIApiKey } from '../settings/secretSettings.js';
import { SearchView } from '../ui/SearchView.js';
import { VIEW_TYPE_CHAT, VIEW_TYPE_PROGRESS, VIEW_TYPE_SEARCH } from '../ui/viewIds.js';
import { hashVaultText } from '../vault/hashVaultText.js';
import { ObsidianVaultAccess } from '../vault/ObsidianVaultAccess.js';

function formatIndexAck(
  mode: 'full' | 'incremental',
  body: {
    runId: string;
    scannedCount: number;
    enqueuedCount: number;
    skippedCount: number;
    deletedCount: number;
  },
): string {
  const parts = [
    `scanned ${body.scannedCount}`,
    `queued ${body.enqueuedCount}`,
    `skipped ${body.skippedCount}`,
  ];
  if (mode === 'incremental') parts.push(`deleted ${body.deletedCount}`);
  return `${mode === 'full' ? 'Full' : 'Incremental'} index run ${body.runId}: ${parts.join(', ')}.`;
}

async function buildIndexPayload(plugin: ObsidianAIPlugin) {
  const access = new ObsidianVaultAccess(plugin.app.vault, () => plugin.settings);
  const filesMeta = await access.listFiles([]);
  const apiKey = getOpenAIApiKey(plugin.app);
  console.log('Obsidian AI: buildIndexPayload file discovery', {
    fileCount: filesMeta.length,
    indexedFolders: plugin.settings.indexedFolders,
    excludedFolders: plugin.settings.excludedFolders,
  });
  const files = await Promise.all(
    filesMeta.map(async (vf) => {
      const content = await access.readFile(vf.path);
      return { path: vf.path, content, hash: hashVaultText(content) };
    }),
  );
  return {
    files,
    apiKey,
    dailyNotePathGlobs: plugin.settings.dailyNotePathGlobs,
    dailyNoteDatePattern: plugin.settings.dailyNoteDatePattern,
  };
}

async function revealView(plugin: ObsidianAIPlugin, viewType: string): Promise<void> {
  const { workspace } = plugin.app;
  const existing = workspace.getLeavesOfType(viewType);
  if (existing.length > 0) {
    await workspace.revealLeaf(existing[0]);
    return;
  }
  const leaf = workspace.getLeaf('tab');
  await leaf.setViewState({ type: viewType, active: true });
  await workspace.revealLeaf(leaf);
}

async function runFullReindex(plugin: ObsidianAIPlugin): Promise<void> {
  const transport = plugin.lifecycle?.getTransport();
  if (!transport) {
    showAiNotice('Sidecar is not available.');
    return;
  }
  try {
    const payload = await buildIndexPayload(plugin);
    const res = await transport.send({ type: 'index/full', payload });
    if (res.type === 'index/full') {
      showAiNotice(formatIndexAck('full', res.body));
    }
  } catch (e) {
    showAiNotice(`Reindex failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function runIncrementalReindex(plugin: ObsidianAIPlugin): Promise<void> {
  const transport = plugin.lifecycle?.getTransport();
  if (!transport) {
    showAiNotice('Sidecar is not available.');
    return;
  }
  try {
    const { files, apiKey, dailyNotePathGlobs, dailyNoteDatePattern } = await buildIndexPayload(plugin);
    const res = await transport.send({
      type: 'index/incremental',
      payload: { files, deletedPaths: [], apiKey, dailyNotePathGlobs, dailyNoteDatePattern },
    });
    if (res.type === 'index/incremental') {
      showAiNotice(formatIndexAck('incremental', res.body));
    }
  } catch (e) {
    showAiNotice(`Incremental index failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function registerCommands(plugin: ObsidianAIPlugin): void {
  plugin.addCommand({
    id: 'open-ai-search',
    name: 'Obsidian AI: Open search',
    callback: () => void revealView(plugin, VIEW_TYPE_SEARCH),
  });

  plugin.addCommand({
    id: 'open-ai-chat',
    name: 'Obsidian AI: Open chat',
    callback: () => void revealView(plugin, VIEW_TYPE_CHAT),
  });

  plugin.addCommand({
    id: 'open-ai-progress',
    name: 'Obsidian AI: Open indexing progress',
    callback: () => void revealView(plugin, VIEW_TYPE_PROGRESS),
  });

  plugin.addCommand({
    id: 'reindex-vault-full',
    name: 'Obsidian AI: Reindex vault (full)',
    callback: () => void runFullReindex(plugin),
  });

  plugin.addCommand({
    id: 'reindex-vault-incremental',
    name: 'Obsidian AI: Reindex vault (incremental)',
    callback: () => void runIncrementalReindex(plugin),
  });

  plugin.addCommand({
    id: 'search-from-selection',
    name: 'Obsidian AI: Search from editor selection',
    editorCallback: (editor) => {
      void (async () => {
        const q = editor.getSelection().trim();
        await revealView(plugin, VIEW_TYPE_SEARCH);
        const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH);
        const view = leaves[0]?.view;
        if (view instanceof SearchView) view.applySelectionQuery(q);
      })();
    },
  });
}
