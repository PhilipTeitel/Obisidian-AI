import type { App } from 'obsidian';

export const OPENAI_SECRET_ID = 'obsidian-ai-openai-key';

export function getOpenAIApiKey(app: App): string | undefined {
  const v = app.secretStorage.getSecret(OPENAI_SECRET_ID);
  return v ?? undefined;
}

export function setOpenAIApiKey(app: App, value: string): void {
  app.secretStorage.setSecret(OPENAI_SECRET_ID, value);
}
