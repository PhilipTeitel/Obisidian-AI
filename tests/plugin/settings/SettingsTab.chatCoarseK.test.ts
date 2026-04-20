import { describe, expect, it } from 'vitest';
import {
  CHAT_COARSE_K_MAX,
  CHAT_COARSE_K_MIN,
  DEFAULT_CHAT_COARSE_K,
  clampChatCoarseK,
  normalizeChatCoarseKFromUserInput,
} from '@src/plugin/settings/chatCoarseK.js';

describe('SettingsTab chatCoarseK (RET-4)', () => {
  it('D1_clamp_and_warn_S7', () => {
    expect(normalizeChatCoarseKFromUserInput('0')).toEqual({
      value: CHAT_COARSE_K_MIN,
      warning: `Value clamped to ${CHAT_COARSE_K_MIN}.`,
    });
    expect(normalizeChatCoarseKFromUserInput('999')).toEqual({
      value: CHAT_COARSE_K_MAX,
      warning: `Value clamped to ${CHAT_COARSE_K_MAX}.`,
    });
    expect(normalizeChatCoarseKFromUserInput('12.7').warning).toContain('clamped');
    expect(normalizeChatCoarseKFromUserInput('not-a-number').warning).toBeTruthy();
    expect(normalizeChatCoarseKFromUserInput('24')).toEqual({ value: 24, warning: null });
  });

  it('empty_field_defaults_to_32', () => {
    expect(normalizeChatCoarseKFromUserInput('')).toEqual({
      value: DEFAULT_CHAT_COARSE_K,
      warning: null,
    });
  });

  it('clampChatCoarseK_bounds', () => {
    expect(clampChatCoarseK(0)).toBe(CHAT_COARSE_K_MIN);
    expect(clampChatCoarseK(300)).toBe(CHAT_COARSE_K_MAX);
  });
});
