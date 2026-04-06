import type { IEmbeddingPort } from '../../core/ports/IEmbeddingPort.js';
import { OllamaEmbeddingAdapter } from './OllamaEmbeddingAdapter.js';
import { OpenAIEmbeddingAdapter } from './OpenAIEmbeddingAdapter.js';

/** Mirrors README Plugin Settings: embeddingBaseUrl + embeddingModel. */
export interface EmbeddingAdapterConfig {
  baseUrl: string;
  model: string;
}

export function createEmbeddingPort(
  kind: 'openai' | 'ollama',
  config: EmbeddingAdapterConfig,
): IEmbeddingPort {
  const c = { baseUrl: config.baseUrl.trim(), model: config.model.trim() };
  if (kind === 'openai') return new OpenAIEmbeddingAdapter(c);
  return new OllamaEmbeddingAdapter(c);
}
