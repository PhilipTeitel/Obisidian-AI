import type { ChatMessage } from '../domain/types.js';

/**
 * Pluggable streaming chat (ADR-005). Provider-neutral: async iteration yields text deltas only;
 * adapters map vendor streams to sequential string chunks. Optional `apiKey` from the plugin per request.
 */
export interface IChatPort {
  complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
  ): AsyncIterable<string>;
}
