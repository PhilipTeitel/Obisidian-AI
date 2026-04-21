// @vitest-environment happy-dom

import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ISidecarTransport } from '@src/core/ports/ISidecarTransport.js';
import { CHAT_GROUNDING_POLICY_WIRE_VERSION } from '@src/core/domain/types.js';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';
import type ObsidianAIPlugin from '@src/plugin/main.js';
import { ChatView } from '@src/plugin/ui/ChatView.js';

vi.mock('@src/plugin/ui/showAiNotice.js', () => ({
  showAiNotice: vi.fn(),
}));

vi.mock('@src/plugin/settings/secretSettings.js', () => ({
  getOpenAIApiKey: () => '',
}));

describe('ChatView chat payload (CHAT-4)', () => {
  it('B1_payload_includes_prompts_when_set', async () => {
    const streamChat = vi.fn(async function* () {
      yield { type: 'delta', delta: '' };
      yield { type: 'done', sources: [], groundingOutcome: 'answered', groundingPolicyVersion: 'v1' };
    });
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        vaultOrganizationPrompt: 'ORG HERE',
        chatSystemPrompt: 'SYS HERE',
      },
      lifecycle: {
        getTransport: () =>
          ({ streamChat, send: vi.fn() }) as unknown as ISidecarTransport,
      },
      app: { workspace: { openLinkText: vi.fn() } },
    } as unknown as ObsidianAIPlugin;

    const view = new ChatView({} as never, plugin);
    await view.onOpen();
    (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl.value = 'hello';
    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();

    expect(streamChat).toHaveBeenCalled();
    const payload = (streamChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.systemPrompt).toBe('SYS HERE');
    expect(payload.vaultOrganizationPrompt).toBe('ORG HERE');
    expect(payload.groundingPolicyVersion).toBe(CHAT_GROUNDING_POLICY_WIRE_VERSION);
  });

  it('B1_payload_omits_empty_prompts', async () => {
    const streamChat = vi.fn(async function* () {
      yield { type: 'delta', delta: '' };
      yield { type: 'done', sources: [], groundingOutcome: 'answered', groundingPolicyVersion: 'v1' };
    });
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      lifecycle: {
        getTransport: () =>
          ({ streamChat, send: vi.fn() }) as unknown as ISidecarTransport,
      },
      app: { workspace: { openLinkText: vi.fn() } },
    } as unknown as ObsidianAIPlugin;

    const view = new ChatView({} as never, plugin);
    await view.onOpen();
    (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl.value = 'hello';
    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();

    const payload = (streamChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.systemPrompt).toBeUndefined();
    expect(payload.vaultOrganizationPrompt).toBeUndefined();
  });

  it('B1_prompt_text_verbatim_not_redacted', async () => {
    const streamChat = vi.fn(async function* () {
      yield { type: 'delta', delta: '' };
      yield { type: 'done', sources: [], groundingOutcome: 'answered', groundingPolicyVersion: 'v1' };
    });
    const secret = 'sk-not-a-real-key-please';
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        chatSystemPrompt: secret,
      },
      lifecycle: {
        getTransport: () =>
          ({ streamChat, send: vi.fn() }) as unknown as ISidecarTransport,
      },
      app: { workspace: { openLinkText: vi.fn() } },
    } as unknown as ObsidianAIPlugin;

    const view = new ChatView({} as never, plugin);
    await view.onOpen();
    (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl.value = 'q';
    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();

    const payload = (streamChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.systemPrompt).toBe(secret);
  });

  it('B1_settings_change_takes_effect_next_turn', async () => {
    const streamChat = vi.fn(async function* () {
      yield { type: 'delta', delta: '' };
      yield { type: 'done', sources: [], groundingOutcome: 'answered', groundingPolicyVersion: 'v1' };
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      chatSystemPrompt: 'first',
    };
    const plugin = {
      settings,
      lifecycle: {
        getTransport: () =>
          ({ streamChat, send: vi.fn() }) as unknown as ISidecarTransport,
      },
      app: { workspace: { openLinkText: vi.fn() } },
    } as unknown as ObsidianAIPlugin;

    const view = new ChatView({} as never, plugin);
    await view.onOpen();
    const input = (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl;
    input.value = 'a';
    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();
    settings.chatSystemPrompt = 'second';
    input.value = 'b';
    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();

    const p1 = (streamChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    const p2 = (streamChat as Mock).mock.calls[1]![0] as Record<string, unknown>;
    expect(p1.systemPrompt).toBe('first');
    expect(p2.systemPrompt).toBe('second');
  });
});
