# REQ-002: User-configurable chat prompts (persona + vault organization) composed with the grounding policy

**Source material:**

- [`docs/requirements/REQUIREMENTS.md`](REQUIREMENTS.md) — §6 (Chat and agent: *"User-supplied chat prompts"*), §7 (Providers and settings: *"Chat grounding settings (iter-2)"*), §10 (UX requirements), §15 (Open questions: *"System prompt ordering (iter-2)"*).
- [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) — Accepted. Binding ordering contract for built-in grounding + user prompts.
- [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) — Accepted. Acknowledges structured grounding inputs to chat (Decision 5) and keeps message assembly upstream of `IChatPort`.
- [`docs/features/CHAT-4.md`](../features/CHAT-4.md) — legacy in-flight story; consulted only for scope (two persisted settings, per-request transport, combined budget), not wording.
- [`docs/guides/chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md) — user-facing guide that describes how the two prompts are authored and composed.
- [`docs/requirements/REQ-001-grounding-policy.md`](REQ-001-grounding-policy.md) — prior REQ; REQ-002 layers on top of REQ-001's ordering and non-override guarantees.

**Date:** 2026-04-20
**Status:** Draft

---

## 1. Goals

Each goal traces to a line in the source material cited inline.

- **Let users teach the assistant their personal style once**, via a persisted `chatSystemPrompt` (persona / tone / output format) that is reapplied on every chat turn without re-entry. (REQUIREMENTS §6 *"User-supplied chat prompts … A chat system prompt (persona, tone, style preferences…)"*; REQUIREMENTS §7 *"`chatSystemPrompt` — user-supplied persona/style system prompt"*; `chat-behavior-tuning.md` §"Chat system prompt — what to include".)
- **Let users describe how their vault is organized once**, via a persisted `vaultOrganizationPrompt` (folder conventions, daily-note patterns, tag meanings, recurring headings) that helps the assistant translate natural-language questions into effective retrieval intent. (REQUIREMENTS §6 *"A vault organization prompt (how the user's notes are organized …)"*; REQUIREMENTS §7 *"`vaultOrganizationPrompt` — user-supplied description of how notes are organized"*; `chat-behavior-tuning.md` §"Vault organization prompt — what to include".)
- **Compose both user prompts with the built-in grounding policy in a fixed, observable order** — built-in grounding → `vaultOrganizationPrompt` → `chatSystemPrompt` → retrieval context → history → current user turn — on every chat request. (REQUIREMENTS §6 *"Both user prompts are merged into provider message lists on every chat request in a defined order"*; ADR-011 Decision 2; resolves REQUIREMENTS §15 *"System prompt ordering (iter-2)"*.)
- **Preserve the grounding guarantee regardless of user prompt content**, so neither prompt can relax, disable, or override the vault-only policy. (REQUIREMENTS §6 *"style preferences that do not contradict the grounding policy"*; ADR-011 Decision 2 *"User-supplied system prompts are appended after the built-in policy so they can adjust tone and organizational context but cannot override the grounding directive"*; `chat-behavior-tuning.md` *"They cannot override the grounding policy"*; REQ-001 Goal *"Allow user-supplied chat prompts … without overriding the grounding directive"* and REQ-001 S7.)
- **Bound the combined system-message size**, so user prompts do not silently crowd out retrieval context; when the combined budget is exceeded the user is given observable, non-silent feedback. (`chat-behavior-tuning.md` §"Why two prompts?" *"long prompts crowd out retrieval context and are truncated when the combined system-message budget is exceeded"*; ADR-011 *Consequences* *"Small token overhead on every request"*; REQUIREMENTS §6 *"User-supplied chat prompts"* combined with §5 retrieval context budgets.)
- **Make settings changes take effect on the next chat turn without requiring a plugin or Obsidian reload**, so users can iterate on the wording of their prompts interactively. (REQUIREMENTS §6 *"Both user prompts are merged into provider message lists on every chat request"* — per-request composition implies no cached state; ADR-011 Decision 4 *"user prompts and grounding-policy version are carried per request rather than stored sidecar-side"*.)

## 2. Non-goals

- **Not redefining the built-in grounding policy.** The grounding directive, its insufficient-evidence path, ordering rules, and policy versioning are owned by REQ-001 and ADR-011. This REQ only asserts that user prompts compose with that policy without overriding it. (REQ-001; ADR-011.)
- **Not specifying the exact wording of either user prompt.** Both defaults are empty; the user authors the content. Example wording lives in [`chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md) as guidance, not product-owned copy.
- **Not introducing a user-facing toggle to disable grounding.** Grounding remains non-optional; user prompts are additive only. (ADR-011 Decision 1; REQ-001 Non-goal *"Not introducing user-facing 'grounding on/off' settings"*.)
- **Not changing provider adapters or `IChatPort`.** Message assembly stays upstream of the port; adapters remain provider-neutral. (ADR-005 Decision 5; ADR-011 *Explicit non-decisions*.)
- **Not defining prompt-templating, variable substitution, or conditional prompts.** Both settings are plain text sent verbatim with every request.
- **Not defining prompt import/export, sharing, or versioning across devices.** Settings persist per-vault via the normal plugin data path; cross-device sync is out of scope for MVP (REQUIREMENTS §11).
- **Not specifying secret handling for prompt content.** These settings are user-authored text, not secrets; they are not routed through Obsidian's secret store. (Contrast REQUIREMENTS §2 and CHAT-4 §1 *"they are not secrets and are sent with every chat request so the sidecar never caches them"*.)

## 3. Personas / actors

- **Vault owner configuring chat behavior** — the Obsidian user who opens the plugin's settings tab to author a `chatSystemPrompt` and/or a `vaultOrganizationPrompt`. They expect the settings to persist across Obsidian restarts, apply on the next chat turn, and compose with — not fight — the built-in grounding policy. (REQUIREMENTS §6 *"User-supplied chat prompts"*; REQUIREMENTS §7 *"Chat grounding settings (iter-2)"*; `chat-behavior-tuning.md` §"Why two prompts?".)
- **Vault owner asking vault-specific questions** — the same user, now in the chat pane. They expect the assistant to use their vault-organization hints (folder conventions, daily-note pattern, tag meanings) to translate phrases like *"what did I log under Job search in the last two weeks?"* into effective retrieval, and to use their style prompt to shape the reply format. They also expect that if a prompt value is empty, the assistant behaves as if that prompt were not configured. (REQUIREMENTS §6; `chat-behavior-tuning.md` §"Daily-notes vault" example.)
- **Vault owner iterating on prompt wording** — the same user, refining their prompts while the chat pane is open. They expect to edit a prompt in settings, submit a new chat turn, and have the new wording take effect on that turn — without reloading Obsidian or restarting the plugin. (REQUIREMENTS §6 *"merged into provider message lists on every chat request"*; ADR-011 Decision 4 per-request transport.)

## 4. User scenarios (Gherkin)

### S1 — Persona/tone prompt is saved durably and reused on every subsequent turn

```gherkin
Given the user opens the plugin's settings tab
And   the user writes a persona/tone value into the chatSystemPrompt setting (e.g. "Answer in British English. Prefer short paragraphs over bullet lists.")
And   the user commits the setting change (blur / save action per the settings tab's save pattern)
When  the user submits a chat turn
Then  the persona/tone value is applied to the assistant's reply on that turn
And   the user does not have to re-enter the value for subsequent turns in the same conversation
And   the value persists across Obsidian restarts and is applied on turns in new sessions
```

*Traces to:* REQUIREMENTS §6 *"User-supplied chat prompts … A chat system prompt"*; REQUIREMENTS §7 *"`chatSystemPrompt`"*; ADR-011 Decision 2 & Decision 4; `chat-behavior-tuning.md` §"Chat system prompt — what to include".

### S2 — Vault-organization prompt is saved durably and reused on every subsequent turn

```gherkin
Given the user opens the plugin's settings tab
And   the user writes a vault-organization value into the vaultOrganizationPrompt setting (e.g. "Daily notes live in Daily/YYYY-MM-DD.md. Job-search activity is tagged #jobsearch under ## Job search.")
And   the user commits the setting change
When  the user submits a chat turn that relies on those conventions (e.g. "summarise my job-search activity over the last two weeks")
Then  the vault-organization value is included in the system context for that turn
And   the value is reused on subsequent turns in the same conversation without re-entry
And   the value persists across Obsidian restarts and is applied on turns in new sessions
```

*Traces to:* REQUIREMENTS §6 *"A vault organization prompt (how the user's notes are organized — for example, 'daily notes live in Daily/ with YYYY-MM-DD.md filenames; journal entries use #mood; job search uses #jobsearch')"*; REQUIREMENTS §7 *"`vaultOrganizationPrompt`"*; `chat-behavior-tuning.md` §"Vault organization prompt — what to include" and "Daily-notes vault" example.

### S3 — Both prompts compose with the built-in grounding policy in the canonical order on every request

```gherkin
Given the user has configured both chatSystemPrompt and vaultOrganizationPrompt
And   retrieval returns one or more usable context snippets for the user's question
And   the conversation already has prior turns in it
When  the user submits a chat turn
Then  the system context assembled for that request contains, in this order:
      | 1 | the built-in grounding policy                |
      | 2 | the vaultOrganizationPrompt                  |
      | 3 | the chatSystemPrompt                         |
      | 4 | the retrieval context block                  |
And   prior conversation history follows after the system messages
And   the current user turn is last
And   this same ordering is applied on every subsequent chat turn in the conversation
```

*Traces to:* ADR-011 Decision 2 (the canonical six-item ordering, reproduced for the user prompts case); REQUIREMENTS §6 *"Both user prompts are merged into provider message lists on every chat request in a defined order"*; ADR-005 Decision 5 *"the caller … is responsible for assembling the final provider message list … in the order fixed by ADR-011"*; resolves REQUIREMENTS §15 *"System prompt ordering (iter-2)"*.

### S4 — User prompts cannot relax or override the grounding policy

```gherkin
Given the user has configured a chatSystemPrompt or vaultOrganizationPrompt whose text instructs the assistant to behave in a way that contradicts vault-only grounding (e.g. "answer from your general knowledge if the vault is silent", "use web search", "if no notes match, guess plausibly")
When  the user submits a chat turn for which retrieval returns no usable context
Then  the assistant still emits the product-owned insufficient-evidence reply (per REQ-001 / ADR-011)
And   the assistant does not answer from general knowledge
And   the assistant does not fabricate sources
And   the assistant does not instruct the user to paste their notes into chat
And   the built-in grounding policy remains authoritative over the user prompt text
```

*Traces to:* REQUIREMENTS §6 *"style preferences that do not contradict the grounding policy"*; ADR-011 Decision 2 *"so they can adjust tone and organizational context but cannot override the grounding directive"*; `chat-behavior-tuning.md` *"Instructions that contradict the grounding policy … will be ignored"*; REQ-001 S7 (same property from the grounding-policy side).

### S5 — Combined system-message budget is enforced with user-visible feedback

```gherkin
Given the built-in grounding policy, the vaultOrganizationPrompt, and the chatSystemPrompt together exceed the combined system-message budget
When  the user submits a chat turn (or saves the setting that takes it over budget)
Then  the over-budget condition is surfaced to the user in an observable way (for example: a non-blocking warning in the settings tab and/or a non-silent signal at request time)
And   the built-in grounding policy is preserved in full (never truncated)
And   the user's over-budget input is not silently dropped
And   if truncation is applied, it is applied to the user-supplied prompts only and the user can tell it occurred
```

*Traces to:* `chat-behavior-tuning.md` §"Why two prompts?" *"Both together should be at most a few hundred tokens; long prompts crowd out retrieval context and are truncated when the combined system-message budget is exceeded"*; ADR-011 *Consequences* *"Small token overhead on every request (built-in policy ≈ 150–300 tokens)"* combined with REQUIREMENTS §5 retrieval-context token budgets; REQUIREMENTS §10 UX requirement that failure modes be user-visible (implied by §10 "Insufficient-evidence state … visibly different" pattern — the product does not silently mutate user-visible behavior). Note: the exact truncation strategy (suffix ellipsis vs reject-and-warn) is listed in Open questions.

### S6 — Empty prompt values are treated as absent; no blank system message is sent

```gherkin
Given the user has not configured a chatSystemPrompt (the value is the empty string)
Or    the user has cleared a previously-set chatSystemPrompt back to empty
And   the same holds independently for the vaultOrganizationPrompt
When  the user submits a chat turn
Then  no system message is emitted for the empty prompt(s)
And   the canonical ordering still holds for whichever prompt(s) are set:
      | only vaultOrganizationPrompt set | built-in grounding → vaultOrganizationPrompt → retrieval context → history → user turn |
      | only chatSystemPrompt set        | built-in grounding → chatSystemPrompt → retrieval context → history → user turn        |
      | both empty                       | built-in grounding → retrieval context → history → user turn                           |
And   the plugin's first run, with both defaults empty, adds no prompt noise to chat requests
```

*Traces to:* REQUIREMENTS §6 *"User-supplied chat prompts … Both user prompts are merged into provider message lists on every chat request in a defined order"* (implies absence when unset); `chat-behavior-tuning.md` §"Why two prompts?" *"Both are optional"*; ADR-011 Decision 2 (user-prompt lines are explicitly labeled *"optional, user-supplied"* in the ordering block).

### S7 — Whitespace-only prompts are treated the same as empty

```gherkin
Given the user has entered a value into chatSystemPrompt or vaultOrganizationPrompt that contains only whitespace (spaces, tabs, newlines)
When  the user submits a chat turn
Then  the whitespace-only value is treated as absent
And   no system message is emitted for that value
And   the behavior is identical to S6 "both empty" / "only one set" as applicable
```

*Traces to:* REQUIREMENTS §6 *"User-supplied chat prompts"* (implies meaningful content); `chat-behavior-tuning.md` §"Why two prompts?" *"Keep them short. Both together should be at most a few hundred tokens"* (guidance presumes non-empty semantic content). Consistent with the same rule applied to the built-in grounding flow in REQ-001 (non-fabrication / no blank noise).

### S8 — Settings changes take effect on the next chat turn without a reload

```gherkin
Given the user has the chat pane open
And   the user edits chatSystemPrompt and/or vaultOrganizationPrompt in the settings tab and commits the change
When  the user returns to the chat pane and submits their next chat turn
Then  that turn uses the updated prompt value(s) in the canonical order
And   the user did not reload Obsidian, disable and re-enable the plugin, or start a new conversation to activate the change
And   prior in-flight turns (if any) are not retroactively rewritten; the change applies to the next turn onward
```

*Traces to:* REQUIREMENTS §6 *"merged into provider message lists on every chat request"* (per-request, not per-conversation); ADR-011 Decision 4 *"user prompts and grounding-policy version are carried per request rather than stored sidecar-side"* (no cached copy to invalidate).

### S9 — Clearing a previously-set prompt returns behavior to the "unset" state

```gherkin
Given the user previously configured a non-empty chatSystemPrompt and/or vaultOrganizationPrompt
And   the user returns to the settings tab and clears the value (back to empty)
And   the user commits the change
When  the user submits the next chat turn
Then  that turn behaves as if the cleared prompt had never been set (see S6)
And   no stale cached value from before the clear is sent to the provider
```

*Traces to:* REQUIREMENTS §6 *"User-supplied chat prompts"* (settings are user-owned); ADR-011 Decision 4 per-request transport (no sidecar-side cache to leak a prior value); REQUIREMENTS §7 *"Chat grounding settings (iter-2)"* (settings behavior parallels other user-editable fields).

### S10 — Prompts apply across multi-turn conversations and after a new-conversation reset

```gherkin
Given the user has configured chatSystemPrompt and/or vaultOrganizationPrompt
When  the user submits multiple chat turns in the same conversation
Then  each turn's system context re-includes the configured prompt value(s) in the canonical order
And   when the user clicks "new conversation" (which is a pure client-side reset per REQ-001 / ADR-011 Decision 5)
Then  the first turn of the new conversation also re-includes the configured prompt value(s) in the canonical order
And   the prompts do not need to be re-saved or re-applied for the new conversation to pick them up
```

*Traces to:* REQUIREMENTS §6 *"Conversation history"* and *"New conversation"*; ADR-011 Decision 2 *"on every chat request"* and Decision 5 *"Grounding applies to every turn … no separate 'seed' request is required"* — user prompts follow the same per-request assembly; REQ-001 S5, S6.

### S11 — Only one of the two prompts is set (asymmetric configuration)

```gherkin
Given the user has configured only vaultOrganizationPrompt (chatSystemPrompt is empty)
When  the user submits a chat turn
Then  the system context contains, in order: built-in grounding policy, then vaultOrganizationPrompt, then (if retrieval returned non-empty context) the retrieval context block, then history, then the user turn
And   no blank placeholder is emitted for the unset chatSystemPrompt

Given instead that the user has configured only chatSystemPrompt (vaultOrganizationPrompt is empty)
When  the user submits a chat turn
Then  the system context contains, in order: built-in grounding policy, then chatSystemPrompt, then (if retrieval returned non-empty context) the retrieval context block, then history, then the user turn
And   no blank placeholder is emitted for the unset vaultOrganizationPrompt
```

*Traces to:* ADR-011 Decision 2 (both user-prompt lines marked *"optional, user-supplied"*); REQUIREMENTS §6; covers the asymmetric cases S6 references in aggregate but states the ordering explicitly for each.

### S12 — User-prompt content is not interpreted as secret or redacted

```gherkin
Given the user has entered a non-empty chatSystemPrompt and/or vaultOrganizationPrompt
When  the plugin composes the chat request
Then  the prompt text is sent verbatim as part of the request payload
And   the prompt text is not routed through Obsidian's secret store
And   the prompt text is not redacted or obfuscated in the request body that reaches the configured provider
And   the user's guidance to keep secrets out of these fields (per chat-behavior-tuning.md) remains their responsibility
```

*Traces to:* REQUIREMENTS §2 *"API keys and secrets must use Obsidian's secret store"* combined with CHAT-4 §1 *"they are not secrets and are sent with every chat request so the sidecar never caches them"*; `chat-behavior-tuning.md` §"Vault organization prompt — what to include" *"Avoid … Secrets or credentials. This prompt is sent with every chat request and may be logged at debug."*.

## 5. Constraints

- **Composition order is fixed and observable.** On every chat request the system context is assembled in this order: built-in grounding policy → `vaultOrganizationPrompt` (if set) → `chatSystemPrompt` (if set) → retrieval context (if non-empty) → conversation history → current user turn. User prompts are never inserted before or merged into the grounding policy. (REQUIREMENTS §6 *"in a defined order"*; ADR-011 Decision 2; ADR-005 Decision 5; resolves REQUIREMENTS §15 *"System prompt ordering (iter-2)"*.)
- **Grounding policy is authoritative.** Neither user prompt can disable, override, or relax the vault-only grounding directive or the insufficient-evidence behavior. If a user prompt text contradicts the grounding policy, the grounding policy wins. (ADR-011 Decision 1 *"Grounding is built in, not optional"* and Decision 2 *"cannot override the grounding directive"*; REQ-001 Constraint *"Grounding is non-optional and built into the product"*; `chat-behavior-tuning.md`.)
- **User prompts are sent per-request, not cached sidecar-side.** The values travel with every chat request; the sidecar does not read them from settings storage and does not keep them between requests. (ADR-011 Decision 4 *"user prompts and grounding-policy version are carried per request rather than stored sidecar-side"*; CHAT-4 §1 / Y2.)
- **Empty and whitespace-only prompts are absent.** An empty or whitespace-only `chatSystemPrompt` or `vaultOrganizationPrompt` produces no system message in the assembled context. The plugin's first-run default (both empty) adds no prompt noise. (REQUIREMENTS §6; ADR-011 Decision 2 marks both user-prompt lines as *"optional, user-supplied"*; `chat-behavior-tuning.md` §"Why two prompts?" *"Both are optional"*.)
- **Combined system-message size is bounded.** The built-in grounding policy plus both user prompts together must not grow unbounded; there is a combined budget, the built-in policy is never truncated, and any reduction applied to user prompts is not silent to the user. (`chat-behavior-tuning.md` §"Why two prompts?" *"long prompts crowd out retrieval context and are truncated when the combined system-message budget is exceeded"*; ADR-011 *Consequences*; REQUIREMENTS §5 retrieval-context budgets.) Exact numeric budget and truncation strategy — see Open questions.
- **Settings changes apply on the next chat turn, no reload required.** Changes to either setting are observable on the very next request after the user commits the change; no plugin reload, Obsidian restart, or new conversation is required. (REQUIREMENTS §6 *"merged into provider message lists on every chat request"*; ADR-011 Decision 4.)
- **User prompts are user-authored text, not secrets.** They are persisted via the plugin's ordinary settings data path, not Obsidian's secret store, and are transmitted with every chat request. Users are responsible for keeping secrets out of these fields. (REQUIREMENTS §2; CHAT-4 §1; `chat-behavior-tuning.md` §"Vault organization prompt — what to include".)
- **Provider neutrality.** The composition and budget behavior must be observable identically regardless of which chat provider (OpenAI, Ollama, or future providers) is configured, because assembly is upstream of `IChatPort`. (ADR-005 Decision 1 & Decision 5; ADR-011 *Explicit non-decisions* — `IChatPort.complete`'s signature is unchanged.)

## 6. Resolved questions

These questions are already answered by REQUIREMENTS, ADR-011, ADR-005, or `chat-behavior-tuning.md`. They are captured here so downstream design/story planning does not re-open them.

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| 1 | Where in the provider message list do `chatSystemPrompt` and `vaultOrganizationPrompt` sit relative to the built-in grounding policy and the retrieval context? | Fixed order: built-in grounding → `vaultOrganizationPrompt` → `chatSystemPrompt` → retrieval context → history → current user turn. User prompts are appended **after** the built-in policy, never merged into it or placed before it. | ADR-011 Decision 2; REQUIREMENTS §6; resolves REQUIREMENTS §15 *"System prompt ordering (iter-2)"* |
| 2 | Can a user prompt disable, relax, or override the vault-only grounding policy? | No. The grounding policy is authoritative; user prompts can only adjust tone and organizational context. A prompt whose text contradicts grounding is ignored on the points of conflict. | ADR-011 Decision 1 & Decision 2; `chat-behavior-tuning.md`; REQ-001 Resolved Q4 |
| 3 | Are the two user prompts transported per-request or cached in the sidecar? | Per-request. The sidecar does not read them from settings storage and does not cache them between requests. | ADR-011 Decision 4; CHAT-4 §1 / Y2 |
| 4 | What is the default value of each prompt? | Empty string. With defaults, first-run chat behavior is "no user-prompt contribution" and is indistinguishable from the user having explicitly cleared both settings. | REQUIREMENTS §7 implies user-editable settings with no wording owned by the product; ADR-011 Decision 2 marks both as *"optional, user-supplied"*; CHAT-4 Y1 |
| 5 | What happens when a user saves a whitespace-only value? | Treated as empty / absent. No system message is emitted for that prompt. | Consistent with REQUIREMENTS §6 meaning of *"User-supplied"* (implies content) and `chat-behavior-tuning.md` §"Why two prompts?" guidance |
| 6 | Should settings changes require a reload, a new conversation, or just the next chat turn to apply? | Next chat turn. No reload, restart, or new conversation is required because both values travel with every request. | REQUIREMENTS §6; ADR-011 Decision 4 |
| 7 | Are these two settings secrets? | No. They are user-authored text persisted via the plugin's ordinary settings data path. The secret store is reserved for API keys. | REQUIREMENTS §2; CHAT-4 §1; `chat-behavior-tuning.md` §"Vault organization prompt — what to include" |
| 8 | Should message assembly happen inside provider adapters? | No. Assembly is upstream of `IChatPort`; adapters receive the fully-assembled `messages` array and must not reorder, drop, or inject system messages. | ADR-005 Decision 5; ADR-011 *Explicit non-decisions* |
| 9 | Does the insufficient-evidence path consume the user prompts? | No — the insufficient-evidence reply is product-owned and deterministic per policy version; neither user prompt affects its wording (REQ-001 S10). Composition of user prompts is only observable on the answered-from-vault path. | REQ-001 S10; `chat-behavior-tuning.md` §"Interaction with the insufficient-evidence response"; ADR-011 Decision 3 |

## 7. Open questions

These are not resolved by the source material and block downstream design/story planning for the areas they touch.

- [ ] **Exact combined-budget ceiling for built-in policy + `vaultOrganizationPrompt` + `chatSystemPrompt`.** CHAT-4 §4 Y4 suggests "e.g. 1,200 tokens"; ADR-011 *Consequences* references a ~150–300 token policy overhead; `chat-behavior-tuning.md` says "at most a few hundred tokens". A concrete number (and the unit — tokens vs. characters vs. bytes) is not committed in REQUIREMENTS and REQ-001 Open Q4 also lists this. Needs product sign-off before a story can write a deterministic truncation test.
- [ ] **Over-budget strategy: truncate vs reject.** CHAT-4 §4 Y4 defaults to *truncate user prompts with a logged warning*. `chat-behavior-tuning.md` says user prompts "are truncated". The task framing for this REQ explicitly allows either "rejected or truncated with user-visible feedback". Which of the two is the product behavior for MVP, and — if truncation — which prompt is trimmed first when both are set, is unspecified.
- [ ] **Shape of the user-visible feedback when over-budget.** Options in the source material include a non-blocking warning in the settings tab (CHAT-4 §6c *"Over budget"* state) and/or a request-time signal on the chat turn. Whether both are required, or only one, is unspecified. REQUIREMENTS §10 requires visibly distinct failure modes for the insufficient-evidence state but does not speak to this case directly.
- [ ] **Character-count / token-count UI hint in settings.** CHAT-4 §6b mentions *"Show character count hint; link to chat-behavior-tuning"*. Whether that hint is required in MVP (and whether it counts characters vs. a token estimate) is not committed in REQUIREMENTS §7.
- [ ] **Does the vault-organization prompt participate in retrieval?** The prompt is a system message that the model sees; whether its text is also used as a retrieval query/rewrite hint (e.g. to expand "job search" into `#jobsearch` tag targeting) or whether it is purely an LLM-side hint is open. Source material describes it as a system-message contribution only; retrieval rewriting is not committed anywhere and may warrant its own REQ/ADR if it becomes a goal.
- [ ] **Behavior on mid-stream settings change.** If a chat request is already in flight when the user commits a change in the settings tab, S8 specifies the change applies to the next turn — but whether the in-flight turn is allowed to continue with the old values, cancelled, or partially affected is not stated. Current working assumption (from ADR-011 Decision 4 per-request transport): the in-flight turn continues with the values it was dispatched with.
- [ ] **Whether an advanced "preview" of the assembled system context is exposed to users** (e.g. a read-only panel in settings or a debug affordance in chat). Not committed by REQUIREMENTS; `chat-behavior-tuning.md` does not require it. May be useful for trust but is an explicit scope decision for a downstream story.

## 8. Suggested ADR triggers

| Trigger | Why it likely needs an ADR | Related Sn |
|---------|----------------------------|------------|
| Composition order and per-request transport of `chatSystemPrompt` + `vaultOrganizationPrompt` alongside the built-in grounding policy. **Already satisfied by [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) (Accepted, 2026-04-16) and [ADR-005](../decisions/ADR-005-provider-abstraction.md) (Accepted, Decision 5 updated for structured grounding inputs)** — do **not** propose a new ADR. Downstream stories must reference both in their Linked ADRs and Binding constraints sections. | Long-lived constraint on how every chat request is assembled, where message-list composition lives (upstream of `IChatPort`), and how user-provided text interacts with the non-optional grounding directive. Easy to silently regress in any chat adapter, workflow, or settings path if not bound by ADR. ADR-011 encodes the ordering and per-request transport; ADR-005 encodes the port boundary and adapter neutrality. | S1, S2, S3, S4, S6, S7, S8, S9, S10, S11, S12 |

## 9. Links

- Source material: see header
- Related REQ files: [REQ-001 — Always-on vault-only chat grounding policy and insufficient-evidence response](REQ-001-grounding-policy.md) (this REQ layers on top of REQ-001's ordering and non-override guarantees)
- Related ADRs (already exist): [ADR-011 — Vault-only chat grounding](../decisions/ADR-011-vault-only-chat-grounding.md) (Accepted, binding); [ADR-005 — Provider abstraction](../decisions/ADR-005-provider-abstraction.md) (Accepted, Decision 5 binds the assembly boundary)
- Related in-flight / legacy story: [CHAT-4 — User chat system prompt + vault-organization prompt](../features/CHAT-4.md) (consulted only for scope, not wording)
- Related user guide: [`docs/guides/chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md)

---

*Created: 2026-04-20 | Refined by: architect in Discovery Mode*
