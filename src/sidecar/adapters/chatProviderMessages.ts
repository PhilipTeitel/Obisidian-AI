import type { BuildGroundedMessagesHooks, ChatMessage, GroundingContext } from '../../core/domain/types.js';
import {
  COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET,
  clampUserPromptsToCombinedBudget,
  fitUserSystemPromptsToBudget,
} from '../../core/domain/chatUserPromptBudget.js';
import { GROUNDING_POLICY_V1 } from '../../core/domain/groundingPolicy.js';
import { estimateTokens } from '../../core/domain/tokenEstimator.js';

export { GROUNDING_POLICY_V1, GROUNDING_POLICY_VERSION } from '../../core/domain/groundingPolicy.js';
export {
  COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET,
  clampUserPromptsToCombinedBudget,
  estimateCombinedBuiltinAndUserPromptTokens,
  fitUserSystemPromptsToBudget,
} from '../../core/domain/chatUserPromptBudget.js';

/** Must match PRV-2 / README: injected before the last user turn when context is non-empty. */
export const VAULT_CONTEXT_PREFIX = 'Vault context (use only this material for answering):\n';

/**
 * Assemble provider messages per ADR-011 §Decision 2: built-in policy → optional organization → optional
 * chat system → vault context (if non-empty) → history → current user turn.
 */
export function buildGroundedMessages(
  messages: ChatMessage[],
  grounding: GroundingContext,
  hooks?: BuildGroundedMessagesHooks,
): ChatMessage[] {
  const policyTokens = estimateTokens(GROUNDING_POLICY_V1);
  const maxUserTokens = Math.max(0, COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET - policyTokens);
  const { vaultOrganization: orgFit, chatSystem: chatFit, truncationRatio } = fitUserSystemPromptsToBudget(
    grounding.vaultOrganizationPrompt ?? '',
    grounding.systemPrompt ?? '',
    maxUserTokens,
  );
  if (truncationRatio > 0) {
    hooks?.onUserPromptTruncated?.(truncationRatio);
  }
  const { vaultOrganization, chatSystem } = clampUserPromptsToCombinedBudget(orgFit, chatFit);

  const prefix: ChatMessage[] = [{ role: 'system', content: GROUNDING_POLICY_V1 }];
  if (vaultOrganization.length > 0) {
    prefix.push({ role: 'system', content: vaultOrganization });
  }
  if (chatSystem.length > 0) {
    prefix.push({ role: 'system', content: chatSystem });
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
