import type { ChatMessage } from '../../core/domain/types.js';

/** Must match PRV-2 / README: injected before the last user turn when context is non-empty. */
export const VAULT_CONTEXT_PREFIX = 'Vault context (use only this material for answering):\n';

/**
 * Map `(messages, context)` from `IChatPort.complete` to provider message arrays.
 * @see docs/features/PRV-2.md
 */
export function buildMessagesWithContext(messages: ChatMessage[], context: string): ChatMessage[] {
  const ctx = context.trim();
  if (ctx === '') {
    return [...messages];
  }
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    return [
      ...messages.slice(0, -1),
      { role: 'system', content: VAULT_CONTEXT_PREFIX + context },
      last,
    ];
  }
  return [...messages, { role: 'user', content: context }];
}
