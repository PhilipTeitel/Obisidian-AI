import { Plugin } from 'obsidian';
import { getCoreLabel } from '../core/index.js';

export default class ObsidianAIPlugin extends Plugin {
  async onload(): Promise<void> {
    void getCoreLabel();
  }
}
