import type { IChatPort } from '../../core/ports/IChatPort.js';
import { OllamaChatAdapter } from './OllamaChatAdapter.js';
import { OpenAIChatAdapter } from './OpenAIChatAdapter.js';

/** Mirrors README Plugin Settings: chatBaseUrl + chatModel. */
export interface ChatAdapterConfig {
  baseUrl: string;
  model: string;
}

export function createChatPort(kind: 'openai' | 'ollama', config: ChatAdapterConfig): IChatPort {
  const c = { baseUrl: config.baseUrl.trim(), model: config.model.trim() };
  if (kind === 'openai') return new OpenAIChatAdapter(c);
  return new OllamaChatAdapter(c);
}
