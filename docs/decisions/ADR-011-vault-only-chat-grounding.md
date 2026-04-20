# ADR-011: Vault-only chat grounding (non-optional, insufficient-evidence response)

**Status:** Accepted  
**Date:** 2026-04-16

---

## Context

[REQUIREMENTS §1](../requirements/REQUIREMENTS.md) and [§6](../requirements/REQUIREMENTS.md) commit the product to **vault-only** chat: the assistant must answer from the user's notes, not from general knowledge. The current iteration-2 implementation delivers this only **conditionally**:

- [`buildMessagesWithContext`](../../src/sidecar/adapters/chatProviderMessages.ts) prepends a `VAULT_CONTEXT_PREFIX` system message **only when retrieval produced non-empty context**. When retrieval returns nothing, the provider receives only the user's raw conversation history with **no grounding instruction** at all.
- As a result, the model typically falls back to generic behavior: "I don't have access to your notes. Could you paste the relevant text?" — which is the opposite of the product promise. Users who indexed their vault are told to paste it into chat.
- The plugin-side "new conversation" path ([`ChatView.newConversation`](../../src/plugin/ui/ChatView.ts)) does not inject any grounding reminder either; grounding is effectively discretionary per request.

Users also cannot tell the assistant **how their vault is organized** (daily notes in `Daily/YYYY-MM-DD.md`, journal tags, work vs personal folders, etc.), so the assistant cannot translate queries like "what have I been doing for my job search over the last two weeks?" into meaningful retrieval intent, even when such content is fully indexed.

Without an ADR, every chat adapter and UI path re-decides whether and how to enforce grounding, which directly contradicts [REQUIREMENTS §1](../requirements/REQUIREMENTS.md) ("chat answers use only the vault as knowledge").

---

## Decision

1. **Grounding is built in, not optional.** Every chat completion request built by the sidecar **must** include a built-in **grounding system message** authored and owned by the product. This message:
   - Instructs the model to answer **only** from the provided vault context and conversation history.
   - Forbids fabrication, citation invention, "paste your notes" deflections, and generic answers sourced from training data.
   - Directs the model to emit a structured **insufficient-evidence response** when the vault context does not support an answer.

2. **Defined message ordering.** The provider message list is assembled in this order on **every** chat request, regardless of whether retrieval produced hits:

   ```
   1. system: <built-in grounding policy>         (always present, not user-editable)
   2. system: <vaultOrganizationPrompt>           (optional, user-supplied)
   3. system: <chatSystemPrompt>                  (optional, user-supplied persona/style)
   4. system: <VAULT_CONTEXT_PREFIX + retrievalContext>   (only when retrieval returned non-empty context)
   5. ...prior conversation history (user/assistant turns)
   6. user: <current user turn>
   ```

   User-supplied system prompts are **appended after** the built-in policy so they can adjust tone and organizational context but cannot override the grounding directive. [`buildMessagesWithContext`](../../src/sidecar/adapters/chatProviderMessages.ts) is rewritten to apply this ordering unconditionally; the current conditional early return on empty context is **superseded**.

3. **Insufficient-evidence response path.** When retrieval returns no usable context (zero hits, or all hits below a configured confidence floor), the `ChatWorkflow` does **not** call the chat provider with an empty context. Instead it emits a **deterministic** terminal stream:
   - one or more `delta` chunks containing a product-owned insufficient-evidence message (e.g. "I couldn't find anything in your vault that answers this question. The search ran over …; try narrowing to a folder, tag, or date range."), and
   - a final `done` event with `sources: []` and a `groundingOutcome: 'insufficient_evidence'` marker on the wire.
     Model tokens are **not** spent on this path, and the UI renders it as a distinct state (see [REQUIREMENTS §10](../requirements/REQUIREMENTS.md)).

4. **Chat payload shape extension.** The `chat` message payload between plugin and sidecar gains optional fields so user prompts and grounding-policy version are carried per request rather than stored sidecar-side:

   ```ts
   {
     messages: ChatMessage[],
     apiKey?: string,
     timeoutMs?: number,
     systemPrompt?: string,                // chatSystemPrompt from plugin settings
     vaultOrganizationPrompt?: string,     // vaultOrganizationPrompt from plugin settings
     groundingPolicyVersion?: string,      // e.g. 'v1' — logged, used for A/B copy tuning
   }
   ```

   The existing `context?` field is retained but becomes advisory; the sidecar is authoritative for retrieval context assembly.

5. **Grounding applies to every turn.** `chat/clear` and "new conversation" remain pure client-side resets; because the built-in policy is prepended on **every** chat request by the sidecar, no separate "seed" request is required to reintroduce it.

---

## Consequences

**Positive**

- The product promise is enforced in the message-assembly layer, not left to individual providers or prompts.
- Users get a clear, honest "not in your vault" state instead of a generic "paste your notes" deflection.
- Users can teach the assistant their vault conventions once (in settings) rather than reminding it every turn.
- Provider adapters remain provider-neutral — grounding is assembled upstream of `IChatPort`.

**Negative / costs**

- Small token overhead on every request (built-in policy ≈ 150–300 tokens). Acceptable relative to typical RAG context sizes.
- Behavior shift for users who currently expect the assistant to answer general questions from training data; this is an explicit product position, not a regression.
- The insufficient-evidence path requires deterministic copy that ages well — tracked via `groundingPolicyVersion`.

---

## Alternatives considered

| Alternative                                                                 | Why not chosen                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Keep grounding conditional; document that users should author a good system prompt | Users have reported exactly this failure mode; the product cannot defer its own contract to user-written system prompts.            |
| Inject grounding once per conversation (on `chat/clear` only)                | Multi-turn conversations drift; providers with limited memory or truncation reorder early system messages. Per-request is robust.   |
| Concatenate all prompts into a single system message                         | Loses the ability to log and version each segment; harder to A/B the built-in policy; makes user prompts indistinguishable on-wire. |
| Fabricate a soft retrieval answer when context is empty                      | Contradicts vault-only policy; directly re-creates the bug this ADR addresses.                                                      |

---

## Explicit non-decisions

- This ADR does **not** define the exact wording of the built-in grounding system message; the canonical text lives in code with a `groundingPolicyVersion` tag. Copy iteration is tracked in [REQUIREMENTS §15](../requirements/REQUIREMENTS.md).
- This ADR does **not** change how retrieval itself works (coarse-K, hybrid, filters). Those are covered by [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md), [ADR-013](ADR-013-structured-note-summaries.md), and [ADR-014](ADR-014-temporal-and-path-filters.md).
- This ADR does **not** change `IChatPort.complete`'s signature; provider adapters still receive a final `messages` array. Ordering and grounding are assembled by the workflow/message-builder layer upstream of the port.

---

## Links

- Requirements: [REQUIREMENTS §1](../requirements/REQUIREMENTS.md), [§6](../requirements/REQUIREMENTS.md), [§7](../requirements/REQUIREMENTS.md), [§10](../requirements/REQUIREMENTS.md), [§15](../requirements/REQUIREMENTS.md)
- Related README section: [API Contract](../../README.md#api-contract), [Plugin Settings](../../README.md#plugin-settings), [ChatView](../../README.md#chatview)
- Related stories: [CHAT-1](../features/CHAT-1.md), [CHAT-2](../features/CHAT-2.md), CHAT-3, CHAT-4
- Related ADRs: [ADR-005](ADR-005-provider-abstraction.md), [ADR-009](ADR-009-chat-cancellation-and-timeout.md)
- Superseded behavior: conditional system-message injection in [src/sidecar/adapters/chatProviderMessages.ts](../../src/sidecar/adapters/chatProviderMessages.ts)
