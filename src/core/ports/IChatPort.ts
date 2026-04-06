import type { ChatMessage } from '../domain/types.js';

/** Per-request cancellation and wall-clock budget (ADR-009). */
export interface ChatCompletionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Pluggable streaming chat (ADR-005). Provider-neutral: async iteration yields text deltas only;
 * adapters map vendor streams to sequential string chunks. Optional `apiKey` from the plugin per request.
 */
export interface IChatPort {
  complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string>;
}
