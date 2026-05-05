import type { ChatMessage } from '../domain/types.js';
import type { ProviderTokenUsage } from '../domain/agentRunTrace.js';

/** Per-request cancellation and wall-clock budget (ADR-009). */
export interface ChatCompletionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** AGT-6: provider-neutral terminal usage metadata, when adapters can report it. */
  onUsage?: (usage: ProviderTokenUsage) => void;
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
