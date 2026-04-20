import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { SearchResult } from '../../core/domain/types.js';
import { buildSearchAssemblyFromSettings } from '../settings/buildSearchAssembly.js';
import { getOpenAIApiKey } from '../settings/secretSettings.js';
import type ObsidianAIPlugin from '../main.js';
import { showAiNotice } from './showAiNotice.js';
import { VIEW_TYPE_SEARCH } from './viewIds.js';

const SNIPPET_STYLE_ID = 'obsidian-ai-search-snippet-style';

function ensureSnippetUserSelectStyle(): void {
  if (document.getElementById(SNIPPET_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = SNIPPET_STYLE_ID;
  s.textContent = `.obsidian-ai-search-snippet { user-select: text; -webkit-user-select: text; }`;
  document.head.appendChild(s);
}

export class SearchView extends ItemView {
  private queryInput!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianAIPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SEARCH;
  }

  getDisplayText(): string {
    return 'AI search';
  }

  getIcon(): string {
    return 'search';
  }

  /** UI-2: pre-fill from editor selection; search only when non-empty. */
  applySelectionQuery(text: string): void {
    if (!this.queryInput) return;
    this.queryInput.value = text;
    if (text.trim()) void this.runSearch();
  }

  async onOpen(): Promise<void> {
    ensureSnippetUserSelectStyle();
    const root = this.contentEl;
    root.empty();
    root.createEl('h4', { text: 'Semantic search' });

    const row = root.createDiv({ cls: 'obsidian-ai-search-row' });
    this.queryInput = row.createEl('input', {
      type: 'text',
      attr: { placeholder: 'Query…' },
    });
    this.queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.runSearch();
    });

    const btn = row.createEl('button', { text: 'Search' });
    btn.addEventListener('click', () => void this.runSearch());

    this.resultsEl = root.createDiv({ cls: 'obsidian-ai-search-results' });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async runSearch(): Promise<void> {
    const transport = this.plugin.lifecycle?.getTransport();
    if (!transport) {
      showAiNotice('Sidecar is not available.');
      return;
    }
    const q = this.queryInput.value.trim();
    if (!q) {
      showAiNotice('Enter a search query.');
      return;
    }
    const s = this.plugin.settings;
    const apiKey = getOpenAIApiKey(this.plugin.app);
    this.resultsEl.empty();
    this.resultsEl.createEl('p', { text: 'Searching…' });
    try {
      const res = await transport.send({
        type: 'search',
        payload: {
          query: q,
          k: s.searchResultCount,
          apiKey,
          coarseK: s.chatCoarseK,
          enableHybridSearch: s.enableHybridSearch,
          search: buildSearchAssemblyFromSettings(s),
        },
      });
      if (res.type !== 'search') {
        showAiNotice('Unexpected search response.');
        return;
      }
      this.renderResults(res.body.results);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showAiNotice(`Search failed: ${msg}`);
      this.resultsEl.empty();
      this.resultsEl.createEl('p', { text: msg, cls: 'mod-warning' });
    }
  }

  private renderResults(results: SearchResult[]): void {
    this.resultsEl.empty();
    if (results.length === 0) {
      this.resultsEl.createEl('p', { text: 'No results.' });
      return;
    }
    for (const r of results) {
      const card = this.resultsEl.createDiv({ cls: 'obsidian-ai-search-card' });
      const pathEl = card.createEl('div', { cls: 'obsidian-ai-search-path' });
      const link = pathEl.createEl('a', { text: r.notePath });
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(r.notePath, '', false);
      });
      card.createEl('div', {
        text: `Score: ${r.score.toFixed(4)}`,
        cls: 'obsidian-ai-search-meta',
      });
      const trail = r.headingTrail.length > 0 ? r.headingTrail.join(' › ') : '(no heading trail)';
      card.createEl('div', { text: trail, cls: 'obsidian-ai-search-meta' });
      card.createEl('div', {
        text: r.snippet,
        cls: 'obsidian-ai-search-snippet',
      });
    }
  }
}
