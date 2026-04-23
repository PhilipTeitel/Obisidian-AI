import { ItemView, WorkspaceLeaf } from 'obsidian';
import {
  CHAT_GROUNDING_POLICY_WIRE_VERSION,
  type ChatMessage,
  type GroundingOutcome,
  type Source,
} from '../../core/domain/types.js';
import { compilePathGlobs } from '../../core/domain/pathGlob.js';
import { parseChatInput } from '../../core/domain/chatInputParser.js';
import { buildSearchAssemblyFromSettings } from '../settings/buildSearchAssembly.js';
import { getOpenAIApiKey } from '../settings/secretSettings.js';
import type ObsidianAIPlugin from '../main.js';
import { showAiNotice } from './showAiNotice.js';
import { VIEW_TYPE_CHAT } from './viewIds.js';

type ChatTurn = ChatMessage & {
  groundingOutcome?: GroundingOutcome;
  /** Set on assistant messages after a completed stream (local UI; not in wire `ChatMessage`). */
  sources?: Source[];
};

export class ChatView extends ItemView {
  private messages: ChatTurn[] = [];
  private listEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private abort: AbortController | null = null;
  /** In-flight streaming assistant turn; only the body is updated on each delta. */
  private streamingAssistantTurnEl: HTMLDivElement | null = null;

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

  private shouldShowSources(sources: Source[] | undefined): boolean {
    return sources !== undefined && sources.length > 0;
  }

  private appendSourcesChips(turn: HTMLDivElement, sources: Source[]): void {
    const wrap = turn.createDiv({ cls: 'obsidian-ai-chat-sources' });
    wrap.createEl('div', { text: 'Sources:', cls: 'obsidian-ai-chat-sources-title' });
    for (const s of sources) {
      const line = wrap.createDiv({ cls: 'source-pill' });
      const a = line.createEl('a', { text: s.notePath });
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(s.notePath, '', false);
      });
      if (s.nodeId) line.createSpan({ text: ` (${s.nodeId})` });
    }
  }

  private appendMessageTurn(m: ChatTurn): void {
    const isAssistant = m.role === 'assistant';
    const isInsufficient = isAssistant && m.groundingOutcome === 'insufficient_evidence';
    const turnCls = ['obsidian-ai-chat-turn', m.role, isInsufficient ? 'insufficient-evidence' : '']
      .filter(Boolean)
      .join(' ');
    const turn = this.listEl.createDiv({ cls: turnCls });
    turn.createSpan({ cls: 'obsidian-ai-chat-role-label', text: `${m.role}: ` });
    const body = turn.createDiv({ cls: 'obsidian-ai-chat-body' });
    body.textContent = m.content;
    if (isAssistant && this.shouldShowSources(m.sources) && m.sources) {
      this.appendSourcesChips(turn, m.sources);
    }
  }

  private createStreamingAssistantTurnAtEnd(): HTMLDivElement {
    const turn = this.listEl.createDiv({ cls: 'obsidian-ai-chat-turn assistant' });
    turn.createSpan({ cls: 'obsidian-ai-chat-role-label', text: 'assistant: ' });
    turn.createDiv({ cls: 'obsidian-ai-chat-body' });
    return turn;
  }

  private renderMessages(extraAssistant?: string): void {
    if (extraAssistant === undefined) {
      this.listEl.empty();
      this.streamingAssistantTurnEl = null;
      for (const m of this.messages) {
        this.appendMessageTurn(m);
      }
      return;
    }
    if (extraAssistant.length === 0) {
      return;
    }
    if (!this.streamingAssistantTurnEl) {
      this.streamingAssistantTurnEl = this.createStreamingAssistantTurnAtEnd();
    }
    const body = this.streamingAssistantTurnEl.querySelector<HTMLDivElement>('.obsidian-ai-chat-body');
    if (body) {
      body.textContent = extraAssistant;
    }
  }

  private async sendUserMessage(): Promise<void> {
    const transport = this.plugin.lifecycle?.getTransport();
    if (!transport) {
      showAiNotice('Sidecar is not available.');
      return;
    }
    const raw = this.inputEl.value.trim();
    if (!raw) {
      showAiNotice('Enter a message.');
      return;
    }
    const parsed = parseChatInput(raw);
    let pathGlobs = parsed.pathGlobs;
    const dateRange = parsed.dateRange;
    if (pathGlobs?.length) {
      try {
        compilePathGlobs(pathGlobs);
      } catch {
        showAiNotice('Invalid path glob; sending query unfiltered.');
        pathGlobs = undefined;
      }
    }
    this.inputEl.value = '';
    this.messages.push({ role: 'user', content: parsed.text });
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
      const vaultOrg = ps.vaultOrganizationPrompt.trim();
      const chatSys = ps.chatSystemPrompt.trim();
      for await (const chunk of transport.streamChat(
        {
          messages: messagesForRequest,
          apiKey,
          timeoutMs,
          k: ps.searchResultCount,
          coarseK: ps.chatCoarseK,
          enableHybridSearch: ps.enableHybridSearch,
          search: buildSearchAssemblyFromSettings(ps),
          pathGlobs,
          dateRange,
          timezoneUtcOffsetHours: ps.timezoneUtcOffsetHours,
          dailyNotePathGlobs: ps.dailyNotePathGlobs,
          ...(vaultOrg !== '' ? { vaultOrganizationPrompt: vaultOrg } : {}),
          ...(chatSys !== '' ? { systemPrompt: chatSys } : {}),
          groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
        },
        { signal },
      )) {
        if (chunk.type === 'delta') {
          assistantAcc += chunk.delta;
          this.renderMessages(assistantAcc);
        } else if (chunk.type === 'done') {
          this.messages.push({
            role: 'assistant',
            content: assistantAcc,
            groundingOutcome: chunk.groundingOutcome,
            sources: chunk.sources,
          });
          this.renderMessages();
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
