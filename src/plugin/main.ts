import { Plugin } from 'obsidian';
import { getCoreLabel } from '../core/index.js';
import { registerCommands } from './commands/registerCommands.js';
import { SidecarLifecycle } from './client/SidecarLifecycle.js';
import { DEFAULT_SETTINGS } from './settings/defaults.js';
import { ObsidianAISettingTab } from './settings/SettingsTab.js';
import type { ObsidianAISettings } from './settings/types.js';
import { ChatView } from './ui/ChatView.js';
import { ProgressSlideout } from './ui/ProgressSlideout.js';
import { SearchView } from './ui/SearchView.js';
import { showAiNotice } from './ui/showAiNotice.js';
import { VIEW_TYPE_CHAT, VIEW_TYPE_PROGRESS, VIEW_TYPE_SEARCH } from './ui/viewIds.js';

export default class ObsidianAIPlugin extends Plugin {
  settings: ObsidianAISettings = { ...DEFAULT_SETTINGS };
  lifecycle: SidecarLifecycle | null = null;

  async onload(): Promise<void> {
    console.log('Obsidian AI: plugin loaded');
    void getCoreLabel();
    await this.loadSettings();
    this.addSettingTab(new ObsidianAISettingTab(this.app, this));
    this.registerView(VIEW_TYPE_SEARCH, (leaf) => new SearchView(leaf, this));
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.registerView(VIEW_TYPE_PROGRESS, (leaf) => new ProgressSlideout(leaf, this));
    registerCommands(this);
    this.lifecycle = new SidecarLifecycle({
      app: this.app,
      manifest: this.manifest,
      settings: this.settings,
    });
    try {
      await this.lifecycle.start();
      console.log('Obsidian AI: sidecar started');
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(
        'Obsidian AI: sidecar failed to start — set Node executable path in plugin settings (or OBSIDIAN_AI_NODE), deploy sidecar, reload plugin.',
        e,
      );
      showAiNotice(`Obsidian AI: sidecar failed to start. ${detail}`, 12_000);
    }
  }

  async onunload(): Promise<void> {
    await this.lifecycle?.stop();
    this.lifecycle = null;
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ObsidianAISettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
