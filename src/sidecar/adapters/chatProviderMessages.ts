import type { ChatMessage, GroundingContext } from '../../core/domain/types.js';

/** Must match PRV-2 / README: injected before the last user turn when context is non-empty. */
export const VAULT_CONTEXT_PREFIX = 'Vault context (use only this material for answering):\n';

/** Logged and echoed on terminal events; bump when policy wording changes materially (ADR-011). */
export const GROUNDING_POLICY_VERSION = 'v1';

/**
 * Built-in vault-only grounding policy (ADR-011). User-facing insufficient-evidence copy is emitted
 * by `ChatWorkflow` without calling the model.
 */
export const GROUNDING_POLICY_V1 = `You are an assistant that answers only from the user's Obsidian vault notes and this conversation.

Rules:
- Use only the provided vault context blocks and prior turns. Do not answer from general training knowledge unless the user explicitly asks for something outside the vault.
- If the vault context does not contain enough evidence, reply with a clear insufficient-evidence answer: say you could not find supporting notes, and suggest how to narrow the question (folder, tag, or date range). Do not invent citations or note titles.
- Do not tell the user to paste their vault or imply you lack access if retrieval context was provided; work with what is in the messages.

[grounding_policy_version=${GROUNDING_POLICY_VERSION}]`;

/**
 * Assemble provider messages per ADR-011 §Decision 2: built-in policy → optional organization → optional
 * chat system → vault context (if non-empty) → history → current user turn.
 */
export function buildGroundedMessages(messages: ChatMessage[], grounding: GroundingContext): ChatMessage[] {
  const prefix: ChatMessage[] = [{ role: 'system', content: GROUNDING_POLICY_V1 }];
  const org = grounding.vaultOrganizationPrompt?.trim();
  if (org) {
    prefix.push({ role: 'system', content: org });
  }
  const chatSys = grounding.systemPrompt?.trim();
  if (chatSys) {
    prefix.push({ role: 'system', content: chatSys });
  }

  const ctx = grounding.retrievalContext.trim();
  if (ctx === '') {
    return [...prefix, ...messages];
  }

  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    return [...prefix, ...messages.slice(0, -1), { role: 'system', content: VAULT_CONTEXT_PREFIX + ctx }, last];
  }
  return [...prefix, ...messages, { role: 'user', content: ctx }];
}

/**
 * Legacy helper used by chat adapters: when `context` is empty, messages are passed through unchanged
 * (workflow already called {@link buildGroundedMessages}). When non-empty, full grounding is applied
 * for direct adapter calls (tests, transitional callers).
 */
export function buildMessagesWithContext(messages: ChatMessage[], context: string): ChatMessage[] {
  const ctx = context.trim();
  if (ctx === '') {
    return [...messages];
  }
  return buildGroundedMessages(messages, { retrievalContext: context });
}
