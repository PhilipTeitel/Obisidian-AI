import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { IndexStatusResponse } from '../../core/domain/types.js';
import type ObsidianAIPlugin from '../main.js';
import { showAiNotice } from './showAiNotice.js';
import { VIEW_TYPE_PROGRESS } from './viewIds.js';

const POLL_MS = 2000;

export class ProgressSlideout extends ItemView {
  private bodyEl!: HTMLDivElement;
  private timer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianAIPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PROGRESS;
  }

  getDisplayText(): string {
    return 'AI indexing progress';
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.createEl('h4', { text: 'Index progress' });
    const refreshRow = root.createDiv();
    refreshRow.createEl('button', { text: 'Refresh now' }).addEventListener('click', () => void this.refresh());
    this.bodyEl = root.createDiv({ cls: 'obsidian-ai-progress-body' });
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), POLL_MS);
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.contentEl.empty();
  }

  private async refresh(): Promise<void> {
    const transport = this.plugin.lifecycle?.getTransport();
    if (!transport) {
      this.bodyEl.empty();
      this.bodyEl.createEl('p', { text: 'Sidecar is not available.' });
      return;
    }
    try {
      const res = await transport.send({ type: 'index/status', payload: {} });
      if (res.type !== 'index/status') return;
      this.renderStatus(res.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showAiNotice(`index/status failed: ${msg}`);
    }
  }

  private renderStatus(body: IndexStatusResponse): void {
    this.bodyEl.empty();
    const summary = this.bodyEl.createDiv({ cls: 'obsidian-ai-progress-summary' });
    summary.createEl('p', {
      text: `Pending: ${body.pending} · Processing: ${body.processing} · Completed: ${body.completed} · Failed: ${body.failed} · Dead letter: ${body.deadLetter}`,
    });
    if (body.jobs.length === 0) {
      this.bodyEl.createEl('p', { text: 'No job rows.' });
      return;
    }
    const table = this.bodyEl.createEl('table', { cls: 'obsidian-ai-progress-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const h of ['Note', 'Step', 'Retries', 'Error']) {
      head.createEl('th', { text: h });
    }
    const tb = table.createEl('tbody');
    for (const j of body.jobs) {
      const tr = tb.createEl('tr');
      tr.createEl('td', { text: j.notePath });
      tr.createEl('td', { text: j.currentStep });
      tr.createEl('td', { text: String(j.retryCount) });
      tr.createEl('td', { text: j.errorMessage ?? '' });
    }
  }
}
