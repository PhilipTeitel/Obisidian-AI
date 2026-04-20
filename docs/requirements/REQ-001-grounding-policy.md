# REQ-001: Always-on vault-only chat grounding policy and insufficient-evidence response

**Source material:**

- [`docs/requirements/REQUIREMENTS.md`](REQUIREMENTS.md) — §1 (MVP success criteria), §6 (Chat and agent), §10 (UX requirements), §15 (Open questions).
- [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) — Accepted. Binding ADR for this feature.
- [`docs/features/CHAT-3.md`](../features/CHAT-3.md) — in-flight story describing the same feature technically; consulted only for scope, not wording.
- [`docs/guides/chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md) — user-facing guide, used to identify personas and expected user experience.

**Date:** 2026-04-20
**Status:** Draft

---

## 1. Goals

Each goal traces to a line in the source material cited inline.

- **Enforce vault-only grounding unconditionally on every chat request**, so the assistant never answers questions about the user's notes from training data or general knowledge — including when retrieval returned nothing. (REQUIREMENTS §1 MVP success criteria: *"Vault-only grounding is enforced, not conditional"*; REQUIREMENTS §6 *"Grounding policy (non-optional)"*; ADR-011 Decision 1.)
- **Give the user an honest "insufficient-evidence" answer when the vault cannot support a response**, describing what was searched and suggesting how to narrow the query — instead of a generic "paste your notes" deflection or a fabricated answer. (REQUIREMENTS §1; ADR-011 Context; ADR-011 Decision 3.)
- **Make the insufficient-evidence state visibly distinct in the chat pane**, so the user can tell at a glance that retrieval gated the answer and the assistant did not invent one. (REQUIREMENTS §10 *"Insufficient-evidence state (iter-2)"*.)
- **Preserve grounding across every turn of a conversation**, including after a new-conversation reset or deep into a multi-turn thread. (ADR-011 Decision 2 & Decision 5; REQUIREMENTS §6 *"Conversation history"*.)
- **Allow user-supplied chat prompts to shape tone and vault context without overriding the grounding directive**, so persona/style and vault-organization prompts stay additive. (REQUIREMENTS §6 *"User-supplied chat prompts"*; ADR-011 Decision 2 ordering; `chat-behavior-tuning.md` *"They cannot override the grounding policy"*.)

## 2. Non-goals

- **Not defining the exact wording of the built-in grounding system message.** Default copy is deferred and versioned via `groundingPolicyVersion`. (ADR-011 *Explicit non-decisions*; REQUIREMENTS §15 *"Built-in grounding prompt copy"*.)
- **Not changing how retrieval itself works** — coarse-K, hybrid recall, path/date filters, structured summaries, and retrieval tuning are covered by ADR-012, ADR-013, ADR-014 and are out of scope here. (ADR-011 *Explicit non-decisions*.)
- **Not adding or redesigning provider adapter APIs.** Grounding is assembled upstream of `IChatPort`; this REQ does not touch provider adapters. (ADR-011 *Explicit non-decisions*; CHAT-3 §7 *Files UNCHANGED*.)
- **Not introducing user-facing "grounding on/off" settings.** The grounding policy is built in, not toggleable. (ADR-011 Decision 1 *"Grounding is built in, not optional"*.)
- **Not specifying settings UI for `chatSystemPrompt` / `vaultOrganizationPrompt`.** Those user-editable prompts exist per REQUIREMENTS §7 and `chat-behavior-tuning.md`, but their surface lives in a separate REQ/story (CHAT-4 family); this REQ only asserts that the grounding policy remains authoritative over them.
- **Not defining an agent-write or file-operation grounding policy.** Agent output-folder constraints are in REQUIREMENTS §6 *"Agent (file operations)"* and are not covered here.

## 3. Personas / actors

- **Vault owner (knowledge-worker persona)** — the Obsidian user who has indexed their vault and uses the chat pane to ask questions about their own notes (journal entries, daily notes, job-search tracking, project notes, meeting minutes). They expect answers to come from their own writing and expect to be told honestly when the vault does not contain the answer, rather than receiving a guess. (Implied throughout REQUIREMENTS §1, §6, §10 and exemplified in `chat-behavior-tuning.md` "Daily-notes vault", "Research vault", "Work vault" examples.)
- **Vault owner tuning chat behavior** — same user, acting in their configuration capacity: they may provide a `chatSystemPrompt` (style) and/or `vaultOrganizationPrompt` (how their notes are laid out). They need those prompts to apply without risking the grounding guarantee. (REQUIREMENTS §6 *"User-supplied chat prompts"*; `chat-behavior-tuning.md` §"Why two prompts?".)

## 4. User scenarios (Gherkin)

### S1 — Question answerable from vault returns a grounded answer with sources

```gherkin
Given the user has indexed their vault
And   the vault contains notes that answer the user's question
When  the user submits a question in the chat pane
And   retrieval returns one or more usable context snippets from those notes
Then  the assistant replies using only the retrieved vault context and prior conversation
And   the reply surfaces the source notes as navigable controls that open the corresponding notes
And   the assistant does not cite sources outside the vault
```

*Traces to:* REQUIREMENTS §1 ("Chat answers use only the vault as knowledge"), §6 ("Chat uses retrieval from the hierarchical index to supply vault-only context"), §10 ("Sources from retrieval are surfaced as navigable controls"); ADR-011 Decision 1.

### S2 — Zero usable retrieval context yields a deterministic insufficient-evidence reply

```gherkin
Given the user has indexed their vault
And   retrieval returns no usable context for the user's question
When  the user submits the question in the chat pane
Then  the assistant responds with a product-owned "insufficient-evidence" message
And   the message describes, in plain language, what was searched and suggests how to narrow the query (e.g. folder, tag, or date range)
And   the reply shows no cited sources
And   the assistant does not answer from general knowledge or training data
And   the assistant does not instruct the user to paste their notes into chat
And   the assistant does not fabricate or invent a citation
```

*Traces to:* REQUIREMENTS §1 ("insufficient-evidence message (describing what was searched and suggesting how to narrow the query). The model must not fall back to general knowledge, instruct the user to paste their notes, or otherwise answer from outside the vault"); REQUIREMENTS §6 *"Grounding policy (non-optional)"*; ADR-011 Context and Decision 3.

### S3 — Built-in grounding policy is applied on every chat request

```gherkin
Given the user has the chat pane open
When  the user submits any chat request
Then  the grounding directive that restricts the assistant to vault-only answers is in effect for that request
And   this happens whether or not retrieval returned any context for that request
And   this happens whether or not the user has configured a chatSystemPrompt or vaultOrganizationPrompt
```

*Traces to:* REQUIREMENTS §6 *"The policy is applied regardless of whether retrieval returned snippets"*; ADR-011 Decision 1, Decision 2, Decision 5 *"Grounding applies to every turn"*.

### S4 — Chat pane renders the insufficient-evidence state distinctly from a normal answer

```gherkin
Given retrieval has returned no usable context for the user's question
When  the assistant emits the insufficient-evidence reply
Then  the chat pane renders the reply in a state visibly distinct from a normal assistant answer
And   the rendering contains no "Sources:" footer or source pills
And   a user glancing at the chat can distinguish "no vault match" from "answered from vault"
```

*Traces to:* REQUIREMENTS §10 *"Insufficient-evidence state (iter-2) … render it as a distinct state (visibly different from a normal assistant reply, with no fabricated sources and no 'paste your notes' phrasing)"*; ADR-011 Decision 3.

### S5 — Follow-up turns in an ongoing conversation stay grounded

```gherkin
Given the user has had one or more prior chat turns in the current conversation
And   those prior turns included at least one answered turn (with vault context) and may include an insufficient-evidence turn
When  the user submits a follow-up question
Then  the built-in grounding directive still governs the assistant's response on this turn
And   the assistant still answers only from retrieved vault context and conversation history
And   if retrieval returns no usable context for this turn, the assistant emits the insufficient-evidence reply for this turn (even though previous turns were answered normally)
```

*Traces to:* REQUIREMENTS §6 *"Conversation history"*; ADR-011 Decision 2 ("ordering … on every chat request"), Decision 5 ("Grounding applies to every turn … no separate 'seed' request is required").

### S6 — New-conversation reset does not weaken grounding on the next turn

```gherkin
Given the user clicks "new conversation" in the chat pane
When  the user submits the first question of the fresh conversation
Then  the built-in grounding directive is in effect for that first request
And   the vault-only policy applies identically to how it applied in the prior conversation
```

*Traces to:* REQUIREMENTS §6 *"New conversation: User can clear history and start fresh"*; ADR-011 Decision 5 *"`chat/clear` and 'new conversation' remain pure client-side resets; because the built-in policy is prepended on every chat request by the sidecar, no separate 'seed' request is required"*.

### S7 — User-supplied system / organization prompts do not override grounding

```gherkin
Given the user has configured a chatSystemPrompt (e.g. style preferences)
And   the user has configured a vaultOrganizationPrompt (e.g. "daily notes live in Daily/YYYY-MM-DD.md")
And   retrieval returns no usable context for the user's question
When  the user submits the question in the chat pane
Then  the assistant still emits the insufficient-evidence reply
And   neither user prompt causes the assistant to answer from general knowledge
And   neither user prompt causes the assistant to fabricate sources
```

*Traces to:* REQUIREMENTS §6 *"User-supplied chat prompts … style preferences that do not contradict the grounding policy"*; REQUIREMENTS §7 *"Chat grounding settings (iter-2)"*; ADR-011 Decision 2 (ordering puts built-in policy first, user prompts after); `chat-behavior-tuning.md` *"They cannot override the grounding policy — the assistant will still answer only from your vault and will still return an insufficient-evidence response when retrieval finds nothing"*.

### S8 — The user is told, in the insufficient-evidence reply, how to narrow the query

```gherkin
Given retrieval returns no usable context for the user's question
When  the assistant emits the insufficient-evidence reply
Then  the reply names, in plain language, at least one concrete avenue the user can try (for example: specifying a folder, a tag, a date range, or a more specific keyword)
And   the reply does not imply that the vault is empty or that indexing failed, when it merely means retrieval did not match
```

*Traces to:* REQUIREMENTS §1 *"describing what was searched and suggesting how to narrow the query"*; ADR-011 Decision 3 (example copy: "try narrowing to a folder, tag, or date range"); `chat-behavior-tuning.md` §"Interaction with the insufficient-evidence response".

### S9 — Insufficient-evidence replies are internally consistent (no fabricated citations, no empty-answer shape that looks answered)

```gherkin
Given retrieval returns no usable context for the user's question
When  the assistant emits the insufficient-evidence reply
Then  the reply lists zero sources (no fabricated paths, no fabricated note titles)
And   the reply is not rendered with the "answered from vault" chrome (source pills, source footer, etc.)
And   the user cannot confuse the reply for a successful vault answer
```

*Traces to:* REQUIREMENTS §10 *"no fabricated sources"*; ADR-011 Decision 3 *"`sources: []` and a `groundingOutcome: 'insufficient_evidence'` marker"*, Context ("which is the opposite of the product promise").

### S10 — The insufficient-evidence reply is the product's, not the model's

```gherkin
Given retrieval returns no usable context for the user's question
When  the assistant emits the insufficient-evidence reply
Then  the reply wording is deterministic for a given grounding policy version
And   the reply is not affected by the user's chatSystemPrompt (style/tone preferences)
And   the reply is not affected by which chat provider (OpenAI, Ollama, or future providers) is configured
```

*Traces to:* `chat-behavior-tuning.md` *"Your `chatSystemPrompt` does not affect that response text — it is fixed per policy version"*; ADR-011 Decision 3 *"a product-owned insufficient-evidence message"*; REQUIREMENTS §7 ("MVP chat providers: At least OpenAI and Ollama; the architecture must allow additional providers later").

## 5. Constraints

- **Grounding is non-optional and built into the product.** The vault-only directive is applied on every chat request; it cannot be disabled via user settings. (REQUIREMENTS §1; REQUIREMENTS §6 *"Grounding policy (non-optional)"*; ADR-011 Decision 1.)
- **Policy ordering is fixed.** On each request the message list is assembled in a defined order: built-in grounding policy, then `vaultOrganizationPrompt` (if set), then `chatSystemPrompt` (if set), then retrieval context (if non-empty), then prior conversation history, then the current user turn. User-supplied prompts are appended after the built-in policy and cannot override it. (ADR-011 Decision 2; REQUIREMENTS §6 *"Both user prompts are merged into provider message lists on every chat request in a defined order"*.)
- **Empty-retrieval path is deterministic and model-independent.** When retrieval cannot support an answer, the response is product-owned and does not consume model tokens; it renders identically across chat providers. (ADR-011 Decision 3; REQUIREMENTS §7.)
- **Insufficient-evidence replies carry no sources.** No cited source appears in the reply, and the reply is distinguishable from an answered reply in the UI. (REQUIREMENTS §10; ADR-011 Decision 3.)
- **No "paste your notes" deflection and no general-knowledge fallback.** The assistant must not tell the user to paste notes into chat nor answer from training data when vault retrieval is empty. (REQUIREMENTS §1; ADR-011 Context.)
- **Policy applies per-request, not per-conversation.** New conversations, clears, and long conversation histories do not erode the grounding guarantee. (ADR-011 Decision 5.)
- **Policy is versioned.** A `groundingPolicyVersion` identifier is associated with the built-in policy so copy can evolve without silent behavior drift; the identifier is logged (not shown to users). (ADR-011 Decision 4; REQUIREMENTS §15.)
- **Policy text is short enough to survive provider context pressure.** The built-in policy must not crowd out retrieval context; combined system-message size stays within a bounded budget. (ADR-011 *Consequences* / *Negative*; `chat-behavior-tuning.md` §"Why two prompts?" *"long prompts crowd out retrieval context and are truncated"*.)

## 6. Resolved questions

These questions were raised in earlier scoping (REQUIREMENTS §15 and the ADR-011 decision process) and are already answered by ADR-011, REQUIREMENTS, or the `chat-behavior-tuning.md` guide. They are captured here so downstream stories do not re-open them.

| # | Question                                                                                                     | Resolution                                                                                                                                                                                                                                         | Source                                                                               |
|---|--------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| 1 | Should vault-only grounding be conditional on retrieval returning context, or applied on every request?     | Applied on every request. Grounding is built in and not optional.                                                                                                                                                                                  | ADR-011 Decision 1; REQUIREMENTS §1, §6                                              |
| 2 | How should the provider message list be ordered when user prompts and retrieval context are present?        | Fixed ordering: built-in policy → `vaultOrganizationPrompt` → `chatSystemPrompt` → retrieval context (if non-empty) → prior history → current user turn.                                                                                           | ADR-011 Decision 2; REQUIREMENTS §6 ("in a defined order"); resolves REQUIREMENTS §15 *"System prompt ordering (iter-2)"* |
| 3 | When retrieval returns no usable context, should the assistant call the chat provider with an empty context? | No. The workflow emits a deterministic product-owned insufficient-evidence reply without calling the provider.                                                                                                                                      | ADR-011 Decision 3                                                                   |
| 4 | Should user-supplied `chatSystemPrompt` / `vaultOrganizationPrompt` be allowed to override the grounding policy? | No. They are appended after the built-in policy and cannot override it; style/organizational guidance only.                                                                                                                                        | ADR-011 Decision 2; `chat-behavior-tuning.md` §"Interaction with the insufficient-evidence response"; REQUIREMENTS §6 |
| 5 | Should the insufficient-evidence state be visually distinct in the chat pane, or just a normal-looking reply? | Visually distinct: no "Sources:" footer, distinct style, product-owned copy; users must be able to distinguish at a glance from a fabricated answer.                                                                                               | REQUIREMENTS §10; ADR-011 Decision 3                                                 |
| 6 | Does a new-conversation reset require re-seeding the grounding policy?                                       | No. Because the policy is prepended on every request, `chat/clear` remains a pure client-side reset and no separate seed request is needed.                                                                                                        | ADR-011 Decision 5                                                                   |
| 7 | Should the insufficient-evidence reply be generated by the model (for natural variation) or product-owned?   | Product-owned and deterministic per policy version, so users get a recognizable, trustworthy signal and model tokens are not spent on it.                                                                                                           | ADR-011 Decision 3; `chat-behavior-tuning.md` §"Interaction with the insufficient-evidence response" |
| 8 | Does this feature change `IChatPort` or provider adapters?                                                   | No. Grounding is assembled upstream of `IChatPort`; provider adapters remain provider-neutral.                                                                                                                                                     | ADR-011 *Explicit non-decisions*                                                     |

## 7. Open questions

These are not resolved by the source material and block downstream design/story planning for the areas they touch.

- [ ] **Default copy of the built-in grounding policy text** (the `GROUNDING_POLICY_V1` string). REQUIREMENTS §15 and ADR-011 *Explicit non-decisions* both defer the exact wording. Product must decide the initial copy, including whether it explicitly enumerates refusals ("do not invent citations", "do not instruct the user to paste notes") vs. a terser directive. Until decided, stories can test against the named constant by reference but cannot lock in literal text.
- [ ] **Default copy of the insufficient-evidence reply**, including how concretely it lists "what was searched" (e.g. must it echo the active folder/tag/date filters back to the user, or is a generic "I couldn't find anything in your vault that answers this" sufficient for MVP?). REQUIREMENTS §1 requires *"describing what was searched"* — the level of detail needs product sign-off.
- [ ] **Definition of "usable context"** beyond "zero retrieval hits". ADR-011 Decision 3 allows for *"all hits below a configured confidence floor"*, but no confidence floor is currently specified and CHAT-3 narrows the MVP threshold to zero hits. Whether MVP needs a non-zero floor (e.g. score threshold, hit-count floor), and whether that floor is user-configurable, is open.
- [ ] **Budget for combined system-message size** (built-in policy + `vaultOrganizationPrompt` + `chatSystemPrompt`) before truncation. `chat-behavior-tuning.md` references truncation and ADR-011 *Consequences* references a ~150–300 token policy overhead, but the exact user-visible truncation behavior (warning, silent trim, setting) is unspecified.
- [ ] **User-facing visibility of `groundingPolicyVersion`.** ADR-011 Decision 4 logs the version but does not surface it to users; whether users ever need to see it (e.g. in a "debug info" affordance or a "why did I get this reply?" tooltip) is open.

## 8. Suggested ADR triggers

| Trigger                                                                                                                                                                                                                                                                                                                  | Why it likely needs an ADR                                                                                                                                                                                                                                                                                                  | Related Sn                                 |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|
| Always-on vault-only grounding and deterministic insufficient-evidence response. **Already satisfied by [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) (Accepted, 2026-04-16)** — do not propose a new ADR. Downstream stories must reference ADR-011 in their Linked ADRs and Binding constraints sections. | Long-lived constraint on how every chat request is assembled, what gets sent to providers when retrieval is empty, and how the UI must render the result. Easy to silently regress in any chat adapter, workflow, or UI path if not bound by ADR. ADR-011 encodes ordering, the empty-retrieval path, and payload shape. | S1, S2, S3, S4, S5, S6, S7, S8, S9, S10    |

## 9. Links

- Source material: see header
- Related REQ files: none yet (this is REQ-001)
- Related ADRs (already exist): [ADR-011 — Vault-only chat grounding](../decisions/ADR-011-vault-only-chat-grounding.md) (Accepted); indirectly referenced: [ADR-005 — Provider abstraction](../decisions/ADR-005-provider-abstraction.md), [ADR-012 — Hybrid retrieval and coarse-K](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) (defines the retrieval signal the workflow inspects but is out of scope for this REQ).
- Related in-flight story: [CHAT-3 — Always-on grounding policy + insufficient-evidence response](../features/CHAT-3.md) (consulted only for scope).
- Related user guide: [`docs/guides/chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md).

---

*Created: 2026-04-20 | Refined by: architect in Discovery Mode*
