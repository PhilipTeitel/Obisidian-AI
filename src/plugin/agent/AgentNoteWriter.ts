import { TFile, Vault } from 'obsidian';
import type { ObsidianAISettings } from '../settings/types.js';
import { validateAgentPath } from './validateAgentPath.js';

export class AgentNoteWriter {
  constructor(
    private readonly vault: Vault,
    private readonly settings: () => ObsidianAISettings,
  ) {}

  /**
   * Creates or updates a markdown note only under `agentOutputFolders` and within size budget.
   */
  async writeAgentNote(
    vaultPath: string,
    markdown: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const pathErr = validateAgentPath(vaultPath, this.settings().agentOutputFolders);
    if (pathErr) return { ok: false, error: pathErr };
    const max = this.settings().maxGeneratedNoteSize;
    if (markdown.length > max) return { ok: false, error: `Content exceeds max size (${max})` };

    const existing = this.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof TFile) {
      await this.vault.modify(existing, markdown);
      return { ok: true };
    }
    await this.vault.create(vaultPath, markdown);
    return { ok: true };
  }
}
