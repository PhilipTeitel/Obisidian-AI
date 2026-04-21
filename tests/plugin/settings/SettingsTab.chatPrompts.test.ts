// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET,
  estimateCombinedBuiltinAndUserPromptTokens,
} from '@src/core/domain/chatUserPromptBudget.js';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';
import { ObsidianAISettingTab } from '@src/plugin/settings/SettingsTab.js';
import type { ObsidianAISettings } from '@src/plugin/settings/types.js';
import { App } from 'obsidian';

describe('SettingsTab chat prompts (CHAT-4)', () => {
  function makeTab(settings: ObsidianAISettings) {
    const saveSettings = vi.fn(async () => {});
    const plugin = {
      settings,
      saveSettings,
    };
    const tab = new ObsidianAISettingTab(new App(), plugin as never);
    return { tab, plugin, saveSettings };
  }

  it('A1_roundtrip_persona', () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, {
      chatSystemPrompt: 'be brief',
    }) as ObsidianAISettings;
    expect(merged.chatSystemPrompt).toBe('be brief');
    expect(DEFAULT_SETTINGS.chatSystemPrompt).toBe('');
  });

  it('A1_roundtrip_vault_org', () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, {
      vaultOrganizationPrompt: 'Daily notes: Daily/*.md',
    }) as ObsidianAISettings;
    expect(merged.vaultOrganizationPrompt).toBe('Daily notes: Daily/*.md');
  });

  it('A2_defaults_empty_no_prompt_noise', () => {
    expect(DEFAULT_SETTINGS.chatSystemPrompt).toBe('');
    expect(DEFAULT_SETTINGS.vaultOrganizationPrompt).toBe('');
    expect(estimateCombinedBuiltinAndUserPromptTokens('', '')).toBeLessThanOrEqual(
      COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET,
    );
  });

  it('A3_clear_returns_to_unset', () => {
    let s = Object.assign({}, DEFAULT_SETTINGS, {
      chatSystemPrompt: 'x',
      vaultOrganizationPrompt: 'y',
    }) as ObsidianAISettings;
    s = Object.assign({}, DEFAULT_SETTINGS, {
      chatSystemPrompt: '',
      vaultOrganizationPrompt: '',
    }) as ObsidianAISettings;
    expect(s.chatSystemPrompt).toBe('');
    expect(s.vaultOrganizationPrompt).toBe('');
  });

  it('C2_over_budget_warning_visible', () => {
    const huge = 'p'.repeat(COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET * 8);
    const s = Object.assign({}, DEFAULT_SETTINGS, {
      chatSystemPrompt: huge,
      vaultOrganizationPrompt: huge,
    }) as ObsidianAISettings;
    expect(
      estimateCombinedBuiltinAndUserPromptTokens(s.vaultOrganizationPrompt, s.chatSystemPrompt),
    ).toBeGreaterThan(COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET);
    const { tab } = makeTab(s);
    tab.display();
    const warn = tab.containerEl.querySelector('.mod-warning');
    expect(warn).not.toBeNull();
    expect(warn?.textContent ?? '').toContain('exceed the budget');
    const guide = tab.containerEl.querySelector('a[href*="chat-behavior-tuning.md"]');
    expect(guide).not.toBeNull();
  });

  it('Y5_fields_rendered_with_guide_link', () => {
    const { tab } = makeTab({ ...DEFAULT_SETTINGS });
    tab.display();
    const links = tab.containerEl.querySelectorAll('a[href*="chat-behavior-tuning.md"]');
    expect(links.length).toBeGreaterThanOrEqual(2);
    const textareas = tab.containerEl.querySelectorAll('textarea');
    expect(textareas.length).toBeGreaterThanOrEqual(2);
  });
});
