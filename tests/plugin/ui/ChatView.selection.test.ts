// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ISidecarTransport } from '@src/core/ports/ISidecarTransport.js';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';
import type ObsidianAIPlugin from '@src/plugin/main.js';
import { ChatView } from '@src/plugin/ui/ChatView.js';

const _here = path.dirname(fileURLToPath(import.meta.url));
const _root = path.join(_here, '../../..');
const _styles = readFileSync(path.join(_root, 'styles.css'), 'utf8');

vi.mock('@src/plugin/ui/showAiNotice.js', () => ({
  showAiNotice: vi.fn(),
}));

vi.mock('@src/plugin/settings/secretSettings.js', () => ({
  getOpenAIApiKey: () => '',
}));

beforeAll(() => {
  const s = document.createElement('style');
  s.textContent = _styles;
  document.head.appendChild(s);
});

/** happy-dom / `getComputedStyle` need the pane under `document` for `user-select` and `isConnected`. */
function attachViewRoot(view: ChatView): void {
  document.body.appendChild(view.contentEl);
}

type ChatViewPriv = {
  messages: { role: 'user' | 'assistant'; content: string; sources?: { notePath: string; nodeId?: string }[] }[];
  listEl: HTMLDivElement;
  renderMessages(extra?: string): void;
  streamingAssistantTurnEl: HTMLDivElement | null;
};

describe('ChatView.selection (BUG-2)', () => {
  it('A1_user_body_rendered', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [{ role: 'user', content: 'Hello user' }];
    v.renderMessages();

    const turns = view.contentEl.querySelectorAll('.obsidian-ai-chat-turn.user');
    expect(turns.length).toBe(1);
    const body = turns[0]!.querySelector('.obsidian-ai-chat-body');
    expect(body).not.toBeNull();
    expect(body!.textContent).toBe('Hello user');
  });

  it('A2_assistant_body_rendered', async () => {
    const stream: ISidecarTransport['streamChat'] = async function* () {
      yield { type: 'delta', delta: 'part' };
      yield { type: 'delta', delta: ' two' };
      yield {
        type: 'done',
        sources: [],
        groundingOutcome: 'answered',
        groundingPolicyVersion: 'v1',
      };
    };
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      lifecycle: {
        getTransport: () => ({ streamChat: stream, send: vi.fn() }) as unknown as ISidecarTransport,
      },
      app: { workspace: { openLinkText: vi.fn() } },
    } as unknown as ObsidianAIPlugin;

    const view = new ChatView({} as never, plugin);
    await view.onOpen();
    attachViewRoot(view);
    (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl.value = 'hi';
    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();

    const assistantTurn = view.contentEl.querySelector(
      '.obsidian-ai-chat-turn.assistant',
    ) as HTMLDivElement | null;
    expect(assistantTurn).not.toBeNull();
    const body = assistantTurn!.querySelectorAll('.obsidian-ai-chat-body');
    expect(body.length).toBe(1);
    expect(body[0]!.textContent).toBe('part two');
  });

  it('A3_chrome_outside_body', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages.length = 0;
    v.messages.push(
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: 'a',
        sources: [{ notePath: 'Note.md', nodeId: 'n1' }],
      },
    );
    v.renderMessages();

    const aBody = view.contentEl.querySelector(
      '.obsidian-ai-chat-turn.assistant .obsidian-ai-chat-body',
    ) as HTMLDivElement;
    expect(aBody.querySelector('.obsidian-ai-chat-role-label')).toBeNull();
    expect(aBody.querySelector('.obsidian-ai-chat-sources')).toBeNull();
  });

  it('A4_streaming_preserves_node', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [{ role: 'user', content: 'q' }];
    v.renderMessages();
    v.renderMessages('x');
    const turn = v.listEl.querySelector('.obsidian-ai-chat-turn.assistant') as HTMLDivElement;
    expect(turn).not.toBeNull();
    v.renderMessages('x more');
    const turnAfter = v.listEl.querySelector('.obsidian-ai-chat-turn.assistant') as HTMLDivElement;
    expect(turnAfter).toBe(turn);
  });

  it('Y1_user_body_computed_style', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [{ role: 'user', content: 'select me' }];
    v.renderMessages();
    const body = view.contentEl.querySelector('.obsidian-ai-chat-body') as HTMLElement;
    expect(getComputedStyle(body).userSelect).toBe('text');
  });

  it('Y2_assistant_body_computed_style', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [{ role: 'assistant', content: 'ans' }];
    v.renderMessages();
    const body = view.contentEl.querySelector(
      '.obsidian-ai-chat-turn.assistant .obsidian-ai-chat-body',
    ) as HTMLElement;
    expect(getComputedStyle(body).userSelect).toBe('text');
  });

  it('Y3_no_ancestor_blocks_selection', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [{ role: 'user', content: 'u' }];
    v.renderMessages();
    const body = view.contentEl.querySelector('.obsidian-ai-chat-body') as HTMLElement;
    const root = body.closest('.obsidian-ai-chat-messages');
    expect(root).not.toBeNull();
    let el: Element | null = body;
    while (el) {
      expect(getComputedStyle(el).userSelect).not.toBe('none');
      if (el === root) break;
      el = el.parentElement;
    }
  });

  it('Y4_chrome_not_selectable', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a', sources: [{ notePath: 'N.md' }] },
    ];
    v.renderMessages();
    const label = view.contentEl.querySelector('.obsidian-ai-chat-role-label') as HTMLElement;
    const sources = view.contentEl.querySelector('.obsidian-ai-chat-sources') as HTMLElement;
    expect(getComputedStyle(label).userSelect).toBe('none');
    expect(getComputedStyle(sources).userSelect).toBe('none');
  });

  it('Y5_streaming_preserves_selection', async () => {
    const view = new ChatView({} as never, { settings: { ...DEFAULT_SETTINGS } } as ObsidianAIPlugin);
    await view.onOpen();
    attachViewRoot(view);
    const v = view as unknown as ChatViewPriv;
    v.messages = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'first bubble line' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'q3' },
    ];
    v.renderMessages();
    v.renderMessages('third streaming');

    const bodies = view.contentEl.querySelectorAll<HTMLDivElement>(
      '.obsidian-ai-chat-turn.assistant .obsidian-ai-chat-body',
    );
    expect(bodies.length).toBe(3);
    const firstBubbleBody = bodies[0]!;

    const sel = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(firstBubbleBody);
    sel.removeAllRanges();
    sel.addRange(range);
    const textBefore = sel.toString();
    expect(textBefore.length).toBeGreaterThan(0);

    v.renderMessages('third streaming with more deltas');

    expect(firstBubbleBody.isConnected).toBe(true);
    expect(firstBubbleBody.textContent).toBe('first bubble line');
    expect(sel.toString()).toBe(textBefore);
  });
});
