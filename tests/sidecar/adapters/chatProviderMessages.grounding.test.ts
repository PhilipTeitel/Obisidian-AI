import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@src/core/domain/types.js';
import {
  GROUNDING_POLICY_V1,
  GROUNDING_POLICY_VERSION,
  VAULT_CONTEXT_PREFIX,
  buildGroundedMessages,
} from '@src/sidecar/adapters/chatProviderMessages.js';

describe('chatProviderMessages grounding (CHAT-3)', () => {
  it('A1_policy_always_present_on_empty_context', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];
    const out = buildGroundedMessages(messages, { retrievalContext: '' });
    expect(out[0]?.role).toBe('system');
    expect(out[0]?.content).toBe(GROUNDING_POLICY_V1);
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('A2_ordering_policy_first_then_user_prompts_then_context', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'u' }];
    const out = buildGroundedMessages(messages, {
      vaultOrganizationPrompt: 'org-hint',
      systemPrompt: 'persona',
      retrievalContext: 'CTX-BLOCK',
    });
    expect(out[0]?.content).toBe(GROUNDING_POLICY_V1);
    expect(out[1]).toEqual({ role: 'system', content: 'org-hint' });
    expect(out[2]).toEqual({ role: 'system', content: 'persona' });
    expect(out[3]).toEqual({ role: 'system', content: `${VAULT_CONTEXT_PREFIX}CTX-BLOCK` });
    expect(out[4]).toEqual({ role: 'user', content: 'u' });
  });

  it('Y4_policy_constant_in_sidecar_and_version_exported', () => {
    expect(GROUNDING_POLICY_VERSION).toBe('v1');
    expect(GROUNDING_POLICY_V1).toContain('[grounding_policy_version=v1]');
    expect(GROUNDING_POLICY_V1.length).toBeGreaterThan(50);
  });
});
