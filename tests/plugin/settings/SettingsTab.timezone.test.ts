// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  UTC_OFFSET_HOURS_MAX,
  UTC_OFFSET_HOURS_MIN,
  clampUtcOffsetHoursForResolver,
} from '@src/core/domain/dateRangeResolver.js';
import { DEFAULT_SETTINGS } from '@src/plugin/settings/defaults.js';
import { ObsidianAISettingTab } from '@src/plugin/settings/SettingsTab.js';
import type { ObsidianAISettings } from '@src/plugin/settings/types.js';
import { App } from 'obsidian';

describe('SettingsTab timezone (BUG-3)', () => {
  function makeTab(settings: ObsidianAISettings) {
    const saveSettings = vi.fn(async () => {});
    const plugin = {
      settings,
      saveSettings,
    };
    const tab = new ObsidianAISettingTab(new App(), plugin as never);
    return { tab, plugin, saveSettings };
  }

  it('B1_default_zero', () => {
    expect(DEFAULT_SETTINGS.timezoneUtcOffsetHours).toBe(0);
  });

  it('B2_round_trip', () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, {
      timezoneUtcOffsetHours: -5,
    }) as ObsidianAISettings;
    expect(merged.timezoneUtcOffsetHours).toBe(-5);
    expect(clampUtcOffsetHoursForResolver(merged.timezoneUtcOffsetHours)).toBe(-5);
  });

  it('B3_validation_clamp', async () => {
    const s = { ...DEFAULT_SETTINGS, timezoneUtcOffsetHours: 0 };
    const { tab, saveSettings } = makeTab(s);
    tab.display();
    const warn = tab.containerEl.querySelector('.obsidian-ai-tz-offset-warn');
    const textInputs = tab.containerEl.querySelectorAll('input[type="text"]');
    /** Timezone UTC offset is the first text field after Node executable path (SettingsTab order). */
    const tzInput = textInputs[1] as HTMLInputElement | undefined;
    expect(tzInput).toBeDefined();
    tzInput.value = '99';
    tzInput.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(saveSettings.mock.calls.length).toBeGreaterThan(0));
    expect(s.timezoneUtcOffsetHours).toBe(UTC_OFFSET_HOURS_MAX);
    expect(tzInput.value).toBe(String(UTC_OFFSET_HOURS_MAX));
    expect((warn?.textContent ?? '').toLowerCase()).toContain('clamp');

    tzInput.value = String(UTC_OFFSET_HOURS_MIN - 9);
    tzInput.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => s.timezoneUtcOffsetHours === UTC_OFFSET_HOURS_MIN);
    expect(tzInput.value).toBe(String(UTC_OFFSET_HOURS_MIN));
  });
});
