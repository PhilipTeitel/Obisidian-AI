import { GROUNDING_POLICY_V1 } from './groundingPolicy.js';
import { estimateTokens } from './tokenEstimator.js';

/**
 * Built-in + user-supplied system messages share this ceiling (policy + optional user prompts only;
 * retrieval context is budgeted via search assembly). CHAT-4.
 */
export const COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET = 1200;

export function truncatePrefixToMaxTokens(text: string, maxTokens: number): string {
  if (text.length === 0) return '';
  if (estimateTokens(text) <= maxTokens) return text;
  const ell = '...';
  const ellTok = estimateTokens(ell);
  if (maxTokens <= ellTok) {
    return ell.slice(0, Math.max(1, maxTokens * 4));
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = mid >= text.length ? text : `${text.slice(0, mid)}${ell}`;
    if (estimateTokens(candidate) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return lo >= text.length ? text : `${text.slice(0, lo)}${ell}`;
}

/**
 * Fit optional vault-org + persona prompts under the post-policy token allowance. Truncates persona
 * (`systemPrompt`) first, then vault-org, preserving ADR-011 ordering after truncation.
 */
export function fitUserSystemPromptsToBudget(
  vaultOrganizationPrompt: string,
  chatSystemPrompt: string,
  maxUserTokens: number,
): { vaultOrganization: string; chatSystem: string; truncationRatio: number } {
  const org = vaultOrganizationPrompt.trim();
  const chat = chatSystemPrompt.trim();
  const origTok =
    (org.length > 0 ? estimateTokens(org) : 0) + (chat.length > 0 ? estimateTokens(chat) : 0);
  if (origTok === 0) {
    return { vaultOrganization: '', chatSystem: '', truncationRatio: 0 };
  }
  if (maxUserTokens <= 0) {
    return { vaultOrganization: '', chatSystem: '', truncationRatio: 1 };
  }
  if (origTok <= maxUserTokens) {
    return { vaultOrganization: org, chatSystem: chat, truncationRatio: 0 };
  }

  const orgTok = org.length > 0 ? estimateTokens(org) : 0;
  const chatTok = chat.length > 0 ? estimateTokens(chat) : 0;

  if (!org) {
    const chatOut = truncatePrefixToMaxTokens(chat, maxUserTokens);
    const finalTok = estimateTokens(chatOut);
    return {
      vaultOrganization: '',
      chatSystem: chatOut,
      truncationRatio: (origTok - finalTok) / origTok,
    };
  }

  if (!chat) {
    const orgOut = truncatePrefixToMaxTokens(org, maxUserTokens);
    const finalTok = estimateTokens(orgOut);
    return {
      vaultOrganization: orgOut,
      chatSystem: '',
      truncationRatio: (origTok - finalTok) / origTok,
    };
  }

  if (orgTok >= maxUserTokens) {
    const orgOut = truncatePrefixToMaxTokens(org, maxUserTokens);
    const finalTok = estimateTokens(orgOut);
    return {
      vaultOrganization: orgOut,
      chatSystem: '',
      truncationRatio: (origTok - finalTok) / origTok,
    };
  }

  const roomForChat = maxUserTokens - orgTok;
  let chatOut = chatTok <= roomForChat ? chat : truncatePrefixToMaxTokens(chat, roomForChat);
  let orgOut = org;
  let total = orgTok + estimateTokens(chatOut);
  if (total > maxUserTokens) {
    const over = total - maxUserTokens;
    orgOut = truncatePrefixToMaxTokens(org, orgTok - over);
  }
  total = estimateTokens(orgOut) + estimateTokens(chatOut);
  let utok = total;
  for (let i = 0; i < 64 && utok > maxUserTokens && (orgOut.length > 0 || chatOut.length > 0); i++) {
    if (chatOut.length > 0) {
      const ct = estimateTokens(chatOut);
      chatOut = truncatePrefixToMaxTokens(chatOut, Math.max(0, ct - 1));
    } else {
      const ot = estimateTokens(orgOut);
      orgOut = truncatePrefixToMaxTokens(orgOut, Math.max(0, ot - 1));
    }
    utok = estimateTokens(orgOut) + estimateTokens(chatOut);
  }
  return {
    vaultOrganization: orgOut,
    chatSystem: chatOut,
    truncationRatio: (origTok - utok) / origTok,
  };
}

/**
 * Hard clamp so policy + user-supplied system segments never exceed {@link COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET}
 * (heuristic token counts can overshoot by a few tokens after independent truncations).
 */
export function clampUserPromptsToCombinedBudget(
  vaultOrganization: string,
  chatSystem: string,
): { vaultOrganization: string; chatSystem: string } {
  const policyTokens = estimateTokens(GROUNDING_POLICY_V1);
  const maxUserTok = Math.max(0, COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET - policyTokens);
  let v = vaultOrganization;
  let c = chatSystem;
  for (let i = 0; i < 50_000; i++) {
    if (estimateTokens(v) + estimateTokens(c) <= maxUserTok) {
      return { vaultOrganization: v, chatSystem: c };
    }
    if (c.length > 0) {
      c = truncatePrefixToMaxTokens(c, Math.max(0, estimateTokens(c) - 1));
    } else if (v.length > 0) {
      v = truncatePrefixToMaxTokens(v, Math.max(0, estimateTokens(v) - 1));
    } else {
      return { vaultOrganization: '', chatSystem: '' };
    }
  }
  return { vaultOrganization: v, chatSystem: c };
}

/** Token estimate for settings UI: built-in policy plus trimmed user prompts (CHAT-4 C2). */
export function estimateCombinedBuiltinAndUserPromptTokens(
  vaultOrganizationPrompt: string,
  chatSystemPrompt: string,
): number {
  const org = vaultOrganizationPrompt.trim();
  const chat = chatSystemPrompt.trim();
  return (
    estimateTokens(GROUNDING_POLICY_V1) +
    (org.length > 0 ? estimateTokens(org) : 0) +
    (chat.length > 0 ? estimateTokens(chat) : 0)
  );
}
