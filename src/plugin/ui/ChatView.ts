import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { ChatMessage, Source } from '../../core/domain/types.js';
import { buildSearchAssemblyFromSettings } from '../settings/buildSearchAssembly.js';
import { getOpenAIApiKey } from '../settings/secretSettings.js';
import type ObsidianAIPlugin from '../main.js';
import { showAiNotice } from './showAiNotice.js';
import { VIEW_TYPE_CHAT } from './viewIds.js';

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private listEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private abort: AbortController | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianAIPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return 'AI chat';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.createEl('h4', { text: 'Chat' });

    const toolbar = root.createDiv();
    toolbar.createEl('button', { text: 'New conversation' }).addEventListener('click', () => {
      void this.newConversation();
    });

    this.listEl = root.createDiv({ cls: 'obsidian-ai-chat-messages' });
    const inputRow = root.createDiv({ cls: 'obsidian-ai-chat-input-row' });
    this.inputEl = inputRow.createEl('textarea', {
      attr: { rows: 3, placeholder: 'Message…' },
    });
    const actions = inputRow.createDiv();
    actions
      .createEl('button', { text: 'Send' })
      .addEventListener('click', () => void this.sendUserMessage());
    actions
      .createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.cancelStream());
    this.renderMessages();
  }

  async onClose(): Promise<void> {
    this.cancelStream();
    this.contentEl.empty();
  }

  private cancelStream(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private async newConversation(): Promise<void> {
    this.cancelStream();
    const transport = this.plugin.lifecycle?.getTransport();
    if (transport) {
      try {
        await transport.send({ type: 'chat/clear', payload: {} });
      } catch {
        /* best-effort */
      }
    }
    this.messages = [];
    this.renderMessages();
  }

  private renderMessages(extraAssistant?: string): void {
    this.listEl.empty();
    for (const m of this.messages) {
      const row = this.listEl.createDiv({ cls: `obsidian-ai-chat-msg obsidian-ai-chat-${m.role}` });
      row.createEl('strong', { text: `${m.role}: ` });
      row.createSpan({ text: m.content });
    }
    if (extraAssistant !== undefined && extraAssistant.length > 0) {
      const row = this.listEl.createDiv({ cls: 'obsidian-ai-chat-msg obsidian-ai-chat-assistant' });
      row.createEl('strong', { text: 'assistant: ' });
      row.createSpan({ text: extraAssistant });
    }
  }

  private renderSources(sources: Source[]): void {
    if (sources.length === 0) return;
    const wrap = this.listEl.createDiv({ cls: 'obsidian-ai-chat-sources' });
    wrap.createEl('div', { text: 'Sources:', cls: 'obsidian-ai-chat-sources-title' });
    for (const s of sources) {
      const line = wrap.createDiv();
      const a = line.createEl('a', { text: s.notePath });
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(s.notePath, '', false);
      });
      if (s.nodeId) line.createSpan({ text: ` (${s.nodeId})` });
    }
  }

  private async sendUserMessage(): Promise<void> {
    const transport = this.plugin.lifecycle?.getTransport();
    if (!transport) {
      showAiNotice('Sidecar is not available.');
      return;
    }
    const text = this.inputEl.value.trim();
    if (!text) {
      showAiNotice('Enter a message.');
      return;
    }
    this.inputEl.value = '';
    this.messages.push({ role: 'user', content: text });
    const messagesForRequest = [...this.messages];
    this.renderMessages();

    this.cancelStream();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const apiKey = getOpenAIApiKey(this.plugin.app);
    const timeoutMs = this.plugin.settings.chatTimeout;

    let assistantAcc = '';
    try {
      const ps = this.plugin.settings;
      for await (const chunk of transport.streamChat(
        {
          messages: messagesForRequest,
          apiKey,
          timeoutMs,
          k: ps.searchResultCount,
          coarseK: ps.chatCoarseK,
          search: buildSearchAssemblyFromSettings(ps),
        },
        { signal },
      )) {
        if (chunk.type === 'delta') {
          assistantAcc += chunk.delta;
          this.renderMessages(assistantAcc);
        } else if (chunk.type === 'done') {
          this.messages.push({ role: 'assistant', content: assistantAcc });
          this.renderMessages();
          this.renderSources(chunk.sources);
        }
      }
    } catch (e) {
      if (signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      showAiNotice(`Chat failed: ${msg}`);
    } finally {
      this.abort = null;
    }
  }
}
