import { Plugin } from 'obsidian';
import { getCoreLabel } from '../core/index.js';
import { SidecarLifecycle } from './client/SidecarLifecycle.js';
import { DEFAULT_SETTINGS } from './settings/defaults.js';
import { ObsidianAISettingTab } from './settings/SettingsTab.js';
import type { ObsidianAISettings } from './settings/types.js';

export default class ObsidianAIPlugin extends Plugin {
  settings: ObsidianAISettings = { ...DEFAULT_SETTINGS };
  lifecycle: SidecarLifecycle | null = null;

  async onload(): Promise<void> {
    void getCoreLabel();
    await this.loadSettings();
    this.addSettingTab(new ObsidianAISettingTab(this.app, this));
    this.lifecycle = new SidecarLifecycle({
      app: this.app,
      manifest: this.manifest,
      settings: this.settings,
    });
    try {
      await this.lifecycle.start();
    } catch (e) {
      console.error('Obsidian AI: sidecar failed to start — run `npm run build` and ensure dist/sidecar/server.js exists.', e);
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
