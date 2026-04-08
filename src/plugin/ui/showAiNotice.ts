import { Notice } from 'obsidian';

/**
 * Show an Obsidian toast and mirror the same text to the developer console.
 * Toasts disappear; the console log remains until you clear it.
 */
export function showAiNotice(message: string, duration?: number): Notice {
  console.log(`[Obsidian AI] ${message}`);
  return duration !== undefined ? new Notice(message, duration) : new Notice(message);
}
