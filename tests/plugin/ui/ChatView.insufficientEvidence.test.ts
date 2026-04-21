// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { ISidecarTransport } from '@src/core/ports/ISidecarTransport.js';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';
import type ObsidianAIPlugin from '@src/plugin/main.js';
import { ChatView } from '@src/plugin/ui/ChatView.js';

vi.mock('@src/plugin/ui/showAiNotice.js', () => ({
  showAiNotice: vi.fn(),
}));

vi.mock('@src/plugin/settings/secretSettings.js', () => ({
  getOpenAIApiKey: () => '',
}));

describe('ChatView insufficient evidence (CHAT-3)', () => {
  it('C1_distinct_state_no_sources_footer', async () => {
    const stream: ISidecarTransport['streamChat'] = async function* () {
      yield { type: 'delta', delta: 'No notes' };
      yield {
        type: 'done',
        sources: [],
        groundingOutcome: 'insufficient_evidence',
        groundingPolicyVersion: 'v1',
      };
    };

    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      lifecycle: {
        getTransport: () =>
          ({ streamChat: stream, send: vi.fn() }) as unknown as ISidecarTransport,
      },
      app: {
        workspace: { openLinkText: vi.fn() },
      },
    } as unknown as ObsidianAIPlugin;

    const view = new ChatView({} as never, plugin);
    await view.onOpen();

    const input = view['inputEl'] as HTMLTextAreaElement;
    input.value = 'hello';

    await (view as unknown as { sendUserMessage(): Promise<void> }).sendUserMessage();

    const root = view.contentEl;
    const insufficient = root.querySelector('.insufficient-evidence');
    expect(insufficient).not.toBeNull();
    expect(root.querySelectorAll('.sources-footer').length).toBe(0);
    expect(root.querySelectorAll('.source-pill').length).toBe(0);
  });
});
