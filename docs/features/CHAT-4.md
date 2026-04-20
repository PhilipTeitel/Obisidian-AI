# CHAT-4: User chat system prompt + vault-organization prompt

**Story**: Add two persisted plugin settings — `chatSystemPrompt` (persona/style) and `vaultOrganizationPrompt` (how notes are organized) — surface them in the settings tab, flow them through the `chat` message payload, and have the sidecar merge them into provider messages in the order defined by [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) on **every** chat request. The combined system-message budget is enforced so user prompts cannot silently crowd out retrieval context.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Open

---

## 1. Summary

This story implements the user-configurable side of the vault-only chat contract defined by [REQ-002](../requirements/REQ-002-user-chat-prompts.md): two persisted plugin settings (`chatSystemPrompt` for persona/tone/style, `vaultOrganizationPrompt` for folder conventions, daily-note patterns, tag meanings, and recurring headings) that compose with — but do not override — the built-in grounding policy shipped in [CHAT-3](CHAT-3.md). Defaults are empty, so first-run behavior is indistinguishable from today until the user authors one or both values.

The vault-organization prompt is the critical piece for queries like *"summarise my job-search activity over the last two weeks"* — without it the assistant cannot translate the user's mental model (tags, headings, folder conventions) into retrieval intent. Both prompts are sent with **every** chat request per [ADR-011 Decision 4](../decisions/ADR-011-vault-only-chat-grounding.md); the sidecar never reads them from settings storage and never caches them between requests. That is what makes settings changes take effect on the next chat turn without any reload (REQ-002 S8).

Message assembly continues to live upstream of `IChatPort` per [ADR-005 Decision 5](../decisions/ADR-005-provider-abstraction.md): [`buildGroundedMessages`](../../src/sidecar/adapters/chatProviderMessages.ts) (introduced in CHAT-3) is extended to honor the two user prompts in the canonical ADR-011 order — built-in policy → `vaultOrganizationPrompt` → `chatSystemPrompt` → retrieval context → history → current user turn — while provider adapters stay neutral and must not reorder, drop, or inject system messages. A combined system-message budget (implementer-configured ceiling) bounds the total size of built-in policy + user prompts, with truncation applied only to the user-supplied text and a user-visible signal when it occurs.

**Out-of-scope `Sn` from REQ-002:** none. S1–S12 are all implemented or covered by the acceptance tests below. S4 is covered behaviorally in this story — user-prompt text that contradicts the grounding directive is still placed after the built-in policy, preserving the guarantee — but the deterministic insufficient-evidence terminal stream itself is owned by CHAT-3 and is exercised here only to the extent that its ordering is unaffected by user prompts.

**Prerequisites:** [CHAT-3](CHAT-3.md), [PLG-4](PLG-4.md). **Linked REQ:** [REQ-002](../requirements/REQ-002-user-chat-prompts.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Defines the canonical six-item message ordering (§2 Decision 2) and the per-request transport of user prompts (Decision 4); grounding policy remains authoritative over user-prompt text. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | Decision 5 fixes the assembly boundary upstream of `IChatPort`; adapters must receive the fully-assembled `messages` array and must not reorder, drop, or inject system messages. |
| [`docs/decisions/ADR-004-per-vault-index-storage.md`](../decisions/ADR-004-per-vault-index-storage.md) | Both settings persist per-vault via the plugin's ordinary settings data path (not Obsidian's secret store). |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs (ADR-011, ADR-005, ADR-004) exist and are **Accepted**
- [ ] README, REQ-002, and the linked ADRs do not contradict each other on message ordering, per-request transport, settings persistence, or the assembly boundary
- [ ] Section 4 (Binding constraints) is filled with 6 bullets restated from ADR-011, ADR-005, and REQ-002
- [ ] Section 4b (Ports & Adapters) lists `IChatPort` and explains why no new adapter is introduced even though message-assembly changes touch the port's contract
- [ ] Section 8a (Test Plan) is filled and **every AC ID** from Section 8 (including Phase Y and Phase Z) appears in the **Covers AC** column of at least one row
- [ ] For `IChatPort` listed in Section 4b, Section 8a contains both a **contract test against the port** and an **integration test against a real adapter** (no mock of the chat-provider boundary under test), and Phase Y has a `(binding)` criterion citing each
- [ ] Every Gherkin `Sn` from [REQ-002](../requirements/REQ-002-user-chat-prompts.md) (S1–S12) is mapped to at least one acceptance test row in Section 8a — or explicitly declared out of scope in Section 1 with a reason
- [ ] Phase Y includes at least one criterion with **non-mock** evidence where wrong-stack substitution is a risk (ordering integration test, per-request transport grep, adapter integration test)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Settings `chatSystemPrompt` and `vaultOrganizationPrompt` are persisted by the plugin; defaults are empty strings (no behavior change until user populates them).
2. **Y2** — Both values are sent in the `chat` payload on **every** request. The sidecar never reads them from settings directly and never caches them across requests.
3. **Y3** — Message ordering matches [ADR-011 §2 Decision 2](../decisions/ADR-011-vault-only-chat-grounding.md#decision): built-in policy → `vaultOrganizationPrompt` (if non-empty) → `chatSystemPrompt` (if non-empty) → retrieval context system (if non-empty) → conversation history → current user turn. Adapters must not reorder.
4. **Y4** — Combined system-message token budget is bounded: implementer sets a ceiling (e.g. 1,200 tokens for built-in + user prompts combined); when exceeded, user prompts are truncated with a logged warning — built-in policy is never truncated.
5. **Y5** — Settings tab exposes both fields as multi-line text inputs with help text pointing at [docs/guides/chat-behavior-tuning.md](../guides/chat-behavior-tuning.md).
6. **Y6** — Empty string and whitespace-only values are treated as "not set" (no empty system message appended).

---

## 4b. Ports & Adapters

This story does **not introduce a new adapter**: per [ADR-005 Decision 5](../decisions/ADR-005-provider-abstraction.md) message assembly is upstream of `IChatPort`, and the two new payload fields are consumed by [`buildGroundedMessages`](../../src/sidecar/adapters/chatProviderMessages.ts) before any adapter sees the message list. The row below is kept for traceability because the story's correctness depends on existing `IChatPort` adapters continuing to satisfy their contract (no reordering, dropping, or injection of system messages) once the assembled prefix grows from one system message to up to three.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IChatPort` | [`src/core/ports/IChatPort.ts`](../../src/core/ports/IChatPort.ts) | existing `OpenAIChatAdapter` ([`src/sidecar/adapters/OpenAIChatAdapter.ts`](../../src/sidecar/adapters/OpenAIChatAdapter.ts)), existing `OllamaChatAdapter` ([`src/sidecar/adapters/OllamaChatAdapter.ts`](../../src/sidecar/adapters/OllamaChatAdapter.ts)) | Contract test: in-memory fake adapter that echoes the received `messages` array back to the test. Integration test: `OllamaChatAdapter` against a recorded local-Ollama HTTP fixture (hermetic; no live network). | **No new adapter.** This story modifies the assembler upstream of the port; the port's contract (adapter forwards `messages` verbatim) is unchanged but now exercised with the longer assembled prefix. Traceability row per the plan-story hexagonal-pairing rule. |

---

## 5. API Endpoints + Schemas

Extend the chat payload in [`src/core/domain/types.ts`](../../src/core/domain/types.ts):

```ts
export interface ChatRequestPayload {
  messages: ChatMessage[];
  apiKey?: string;
  context?: string;
  timeoutMs?: number;
  systemPrompt?: string;              // chatSystemPrompt from plugin settings
  vaultOrganizationPrompt?: string;   // vaultOrganizationPrompt from plugin settings
  groundingPolicyVersion?: string;    // echoes plugin-selected policy version (ADR-011 Decision 4)
}
```

Extend `SidecarPluginSettings` in [`src/plugin/settings/SettingsTab.ts`](../../src/plugin/settings/SettingsTab.ts) with the two string fields (defaults: `''`). Update the settings loader and the settings tab UI accordingly.

Extend [`buildGroundedMessages`](../../src/sidecar/adapters/chatProviderMessages.ts) (added in CHAT-3) to honor `systemPrompt` and `vaultOrganizationPrompt` per Y3, and enforce the combined system-message budget per Y4.

`IChatPort.complete` is **unchanged**; the new fields never reach the port directly (ADR-005 Decision 5 / ADR-011 *Explicit non-decisions*).

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

```
SettingsTab
├── existing provider / retrieval settings…
└── "Chat grounding" section (new)
    ├── Vault organization prompt (textarea, multi-line) — with link to chat-behavior-tuning.md
    ├── Chat system prompt (textarea, multi-line)         — with link to chat-behavior-tuning.md
    └── Over-budget warning banner (non-blocking, shown only when combined size exceeds ceiling)
```

ChatView is unchanged beyond CHAT-3's insufficient-evidence rendering; it simply reads both setting values on every `streamChat` dispatch and includes them in the payload when non-empty.

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SettingsTab` (Chat grounding section) | read/write `settings.chatSystemPrompt`, `settings.vaultOrganizationPrompt` | debounced save; derived `isOverBudget` flag | Multi-line textareas; help text links to `docs/guides/chat-behavior-tuning.md`. |
| `ChatView.streamChat` caller | reads current `settings.chatSystemPrompt` and `settings.vaultOrganizationPrompt` on each dispatch | none | No memoization — ensures S8 (settings change takes effect next turn without reload). |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | N/A (settings are local). |
| Error | N/A for persistence; a failed save would already be surfaced by the existing settings save pattern. |
| Empty | Both textareas are empty on first run; placeholders explain purpose and link to the tuning guide. |
| Populated | Saved on blur / debounce; no visible confirmation beyond the existing pattern. |
| Over budget | Non-blocking warning banner: "Combined system prompts exceed the budget; user prompts will be truncated at request time." |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts` | Ordering, empty/whitespace no-op, grounding-first-despite-override, per-turn re-application, truncation and policy-never-truncated tests (B2–B5, C1). |
| 2 | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts` | Settings round-trip, defaults empty, clear-returns-to-unset, over-budget warning UI (A1–A3, C2). |
| 3 | `tests/plugin/ui/ChatView.payload.test.ts` | Payload includes prompts when set, omits empty, sends updated value on next turn without reload, sends verbatim not redacted (B1). |
| 4 | `tests/core/workflows/ChatWorkflow.userPrompts.test.ts` | Prompts re-included on every turn and on the first turn after "new conversation" reset (B4). |
| 5 | `tests/contract/chat-port.contract.ts` | Generic `IChatPort` contract suite asserting any adapter forwards the assembled `messages` array verbatim — no reorder, no drop, no injection. |
| 6 | `tests/sidecar/adapters/OllamaChatAdapter.userPrompts.integration.test.ts` | Hermetic integration test that runs the real `OllamaChatAdapter` against a recorded Ollama HTTP fixture and asserts the wire body contains the three system messages in canonical ADR-011 order. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | Extend `ChatRequestPayload` with `systemPrompt`, `vaultOrganizationPrompt`, `groundingPolicyVersion`. |
| 2 | `src/plugin/settings/SettingsTab.ts` | Add `chatSystemPrompt` and `vaultOrganizationPrompt` UI fields, defaults, persistence, and the over-budget warning banner. |
| 3 | `src/plugin/ui/ChatView.ts` | Read current setting values on each dispatch and include them (when non-empty) in the `streamChat` payload. |
| 4 | `src/sidecar/adapters/chatProviderMessages.ts` | Insert user prompts per Y3; enforce combined budget per Y4; treat empty/whitespace as absent per Y6; never truncate built-in policy. |
| 5 | `src/sidecar/runtime/SidecarRuntime.ts` | Forward the new payload fields from transport into `runChatStream` options. |
| 6 | `src/core/workflows/ChatWorkflow.ts` | Accept user prompts and grounding-policy version in options; pass through to message assembly on every turn (including the first turn after a client-side new-conversation reset). |
| 7 | `docs/guides/chat-behavior-tuning.md` | Already authored; referenced from the settings help text (no functional change required here — verify the link resolves). |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — prompts are assembled upstream; the port's signature is stable (ADR-005 Decision 5, ADR-011 *Explicit non-decisions*).
- `src/sidecar/adapters/OpenAIChatAdapter.ts`, `src/sidecar/adapters/OllamaChatAdapter.ts` — adapters must not change; they already forward the assembled `messages` array verbatim. The new contract test and integration test guard against silent regression.

---

## 8. Acceptance Criteria Checklist

### Phase A: Settings persistence

- [ ] **A1** — `chatSystemPrompt` and `vaultOrganizationPrompt` round-trip through plugin settings (read on load, saved on change, persisted across plugin reload).
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A1_roundtrip_persona(vitest)`, `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A1_roundtrip_vault_org(vitest)`

- [ ] **A2** — Defaults are empty strings; on first run with defaults, no extra prompt noise appears in the assembled request.
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A2_defaults_empty_no_prompt_noise(vitest)`

- [ ] **A3** — Clearing a previously-set prompt back to empty returns behavior to the "unset" state on the next chat turn; no stale cached value is sent.
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A3_clear_returns_to_unset(vitest)`

### Phase B: Transport + assembly

- [ ] **B1** — `streamChat` payload includes `systemPrompt` and `vaultOrganizationPrompt` whenever the corresponding setting is non-empty; omits them when empty; sends the text verbatim without redaction.
  - Evidence: `tests/plugin/ui/ChatView.payload.test.ts::B1_payload_includes_prompts_when_set(vitest)`, `tests/plugin/ui/ChatView.payload.test.ts::B1_payload_omits_empty_prompts(vitest)`, `tests/plugin/ui/ChatView.payload.test.ts::B1_prompt_text_verbatim_not_redacted(vitest)`, `tests/plugin/ui/ChatView.payload.test.ts::B1_settings_change_takes_effect_next_turn(vitest)`

- [ ] **B2** — `buildGroundedMessages` emits system messages in the canonical order: built-in policy → `vaultOrganizationPrompt` → `chatSystemPrompt` → retrieval context. Both asymmetric cases (only one of the two set) produce the correct two-system-message prefix.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_canonical(vitest)`, `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_only_vault_org(vitest)`, `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_only_system_prompt(vitest)`

- [ ] **B3** — Empty-string and whitespace-only values for either prompt produce **no** extra system message; the canonical ordering collapses to whichever prompts are set.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_empty_prompts_noop(vitest)`, `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_whitespace_prompts_noop(vitest)`

- [ ] **B4** — Configured prompts are re-included in the system context on every chat turn in a conversation, and on the first turn of a conversation after the client-side "new conversation" reset (no re-save required).
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B4_prompts_re_applied_every_turn(vitest)`, `tests/core/workflows/ChatWorkflow.userPrompts.test.ts::B4_new_conversation_reset_still_includes_prompts(vitest)`

- [ ] **B5** — A user prompt whose text tries to relax or override the grounding policy (e.g. "answer from general knowledge if the vault is silent") is still placed **after** the built-in policy in the assembled message list; the built-in policy text is not modified, and user-prompt text never appears before it.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B5_grounding_first_despite_override_attempt(vitest)`

### Phase C: Budget

- [ ] **C1** — When the combined size of built-in policy + user prompts exceeds the configured ceiling, user prompt text is truncated (suffix ellipsis) and a `warn`-level log entry fires with the truncation ratio. The built-in policy is preserved verbatim and is never truncated.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::C1_truncation_user_prompts_only(vitest)`, `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::C1_builtin_policy_never_truncated(vitest)`

- [ ] **C2** — When the combined size in settings exceeds the ceiling, the settings tab shows a non-blocking, user-visible warning banner pointing to the tuning guide.
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::C2_over_budget_warning_visible(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** Settings `chatSystemPrompt` and `vaultOrganizationPrompt` persist via the plugin's settings data path with empty-string defaults; first-run chat behavior is byte-identical to today.
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A2_defaults_empty_no_prompt_noise(vitest)`, `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A1_roundtrip_persona(vitest)`

- [ ] **Y2** — **(binding)** Sidecar code never reads `chatSystemPrompt` or `vaultOrganizationPrompt` from settings storage; values only flow in via the `ChatRequestPayload`. Per-request transport per ADR-011 Decision 4.
  - Evidence: `rg "chatSystemPrompt|vaultOrganizationPrompt" src/sidecar` returns only payload-type references and message-assembly arguments — no settings-storage reads (checked-in as `scripts/verify-chat-prompt-transport.mjs` or equivalent grep assertion run in CI).

- [ ] **Y3** — **(binding)** Assembled message ordering matches ADR-011 §2 Decision 2 on every request, including the asymmetric cases from REQ-002 S6/S11.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_canonical(vitest)`

- [ ] **Y4** — **(binding)** The built-in grounding policy is preserved verbatim when the combined budget is exceeded; only user-supplied text is truncated, and the truncation is logged at `warn` level (not silent).
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::C1_builtin_policy_never_truncated(vitest)`

- [ ] **Y5** — **(binding)** Settings tab exposes both fields as multi-line inputs with help text linking to [`docs/guides/chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md); both fields are keyboard-accessible and use the standard settings save pattern.
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::Y5_fields_rendered_with_guide_link(vitest)`

- [ ] **Y6** — **(binding)** Empty-string and whitespace-only values produce no system message and are indistinguishable from "unset" downstream.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_empty_prompts_noop(vitest)`, `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_whitespace_prompts_noop(vitest)`

- [ ] **Y7** — **(binding)** `IChatPort` contract: any adapter forwards the assembled `messages` array verbatim — no reordering, no dropping, no injection of system messages — regardless of how many system messages precede the history.
  - Evidence: `tests/contract/chat-port.contract.ts::adapter_does_not_reorder_or_inject_system_messages(vitest)`

- [ ] **Y8** — **(binding)** Real `OllamaChatAdapter` run against a hermetic recorded fixture sends the three system messages (policy, vault-org, persona) on the wire in canonical ADR-011 order, with no reordering, merging, or injection by the adapter. Pair with the contract test in Y7.
  - Evidence: `tests/sidecar/adapters/OllamaChatAdapter.userPrompts.integration.test.ts::Y8_forwards_assembled_messages_verbatim(vitest)`

- [ ] **Y9** — **(binding)** Core workflow boundary stays clean after signature changes (no core→plugin or core→sidecar imports introduced).
  - Evidence: `npm run check:boundaries`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A for this repo layout; imports use `src/core/domain/types.js` per existing convention.**
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations; truncation fires a `warn` log; prompt text is not logged at `info` level (debug-only for local troubleshooting per risk item 3).
- [ ] **Z6** — `/review-story CHAT-4` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output).

---

## 8a. Test Plan

Unified plan — every AC ID in Section 8 appears in **Covers AC** of at least one row; every `Sn` in [REQ-002](../requirements/REQ-002-user-chat-prompts.md) S1–S12 appears in **Covers Sn** of at least one row. `IChatPort` has both a `contract` row (row 18) and an `integration` row (row 19) per the hexagonal-pairing rule.

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A1_roundtrip_persona` | A1, Y1 | S1 | Persona/tone persists across reload. |
| 2 | unit | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A1_roundtrip_vault_org` | A1, Y1 | S2 | Vault-org prompt persists across reload. |
| 3 | unit | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A2_defaults_empty_no_prompt_noise` | A2, Y1 | S1, S2 | First-run defaults are empty; no system message added. |
| 4 | unit | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A3_clear_returns_to_unset` | A3 | S9 | Clearing returns to "unset"; no stale cached value. |
| 5 | unit | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::C2_over_budget_warning_visible` | C2 | S5 | Settings-tab over-budget banner; links to tuning guide. |
| 6 | unit | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::Y5_fields_rendered_with_guide_link` | Y5 | S1, S2 | Both textareas + help link present and keyboard-accessible. |
| 7 | unit | `tests/plugin/ui/ChatView.payload.test.ts::B1_payload_includes_prompts_when_set` | B1 | S1, S2 | Both fields included on payload when non-empty. |
| 8 | unit | `tests/plugin/ui/ChatView.payload.test.ts::B1_payload_omits_empty_prompts` | B1 | S6 | Fields omitted when empty (not sent as `""`). |
| 9 | unit | `tests/plugin/ui/ChatView.payload.test.ts::B1_prompt_text_verbatim_not_redacted` | B1 | S12 | Text sent verbatim; not routed through secret store; not redacted. |
| 10 | unit | `tests/plugin/ui/ChatView.payload.test.ts::B1_settings_change_takes_effect_next_turn` | B1 | S8 | Edit-then-send uses the updated value without reload. |
| 11 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_canonical` | B2, Y3 | S3 | Canonical six-item ordering per ADR-011. |
| 12 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_only_vault_org` | B2 | S11 | Asymmetric: only vault-org set. |
| 13 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order_only_system_prompt` | B2 | S11 | Asymmetric: only persona set. |
| 14 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_empty_prompts_noop` | B3, Y6 | S6 | Empty strings → no system message. |
| 15 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_whitespace_prompts_noop` | B3, Y6 | S7 | Whitespace-only treated as absent. |
| 16 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B4_prompts_re_applied_every_turn` | B4 | S10 | Prompts re-applied on multi-turn conversation. |
| 17 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B5_grounding_first_despite_override_attempt` | B5 | S4 | User-prompt override attempt: built-in policy still first; its text unchanged. |
| 18 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::C1_truncation_user_prompts_only` | C1 | S5 | Truncation suffixes user prompts only; `warn` log fires with ratio. |
| 19 | unit | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::C1_builtin_policy_never_truncated` | C1, Y4 | S5 | Built-in policy preserved verbatim when over budget. |
| 20 | unit | `tests/core/workflows/ChatWorkflow.userPrompts.test.ts::B4_new_conversation_reset_still_includes_prompts` | B4 | S10 | First turn after "new conversation" reset still re-includes prompts. |
| 21 | contract | `tests/contract/chat-port.contract.ts::adapter_does_not_reorder_or_inject_system_messages` | Y7 | S3, S11 | Generic contract: any `IChatPort` adapter must forward `messages` verbatim. |
| 22 | integration | `tests/sidecar/adapters/OllamaChatAdapter.userPrompts.integration.test.ts::Y8_forwards_assembled_messages_verbatim` | Y8 | S3 | Real `OllamaChatAdapter` against recorded Ollama HTTP fixture; asserts wire body ordering. |
| 23 | script | `scripts/verify-chat-prompt-transport.mjs` (invoked from `npm run check:chat-prompt-transport`) | Y2 | S1, S2, S8, S9 | `rg`-based grep ensuring sidecar never reads the two settings from storage; values only flow via payload. |
| 24 | script | `npm run check:boundaries` | Y9 | — | Core workflow boundary stays clean after signature changes. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Users write prompts that contradict the grounding policy (e.g. "answer from general knowledge when vault is silent"). | Built-in policy appears **first** in the assembled message list (Y3, B5); explicit guidance lives in [`chat-behavior-tuning.md`](../guides/chat-behavior-tuning.md). Insufficient-evidence path (owned by CHAT-3) is deterministic and does not consume user prompts (REQ-002 Resolved Q9). |
| 2 | Very long vault-organization prompts crowd out retrieval context. | Combined budget ceiling with truncation of user prompts only (Y4, C1); settings-tab warning (C2); guide recommends short, factual conventions. |
| 3 | Sensitive content accidentally placed in a "personal" vault-organization prompt. | Settings help text flags this; the plugin never logs full prompt at `info` (Z5 — `debug` only, local troubleshooting). These settings are user-authored text and not secrets (REQ-002 Constraint; S12). |
| 4 | Exact budget ceiling and over-budget strategy (truncate vs reject) are not committed by REQ-002 (Open Q1, Q2, Q3). | Implementer adopts CHAT-4 legacy defaults: ceiling ≈ 1,200 tokens combined; truncate user prompts with suffix ellipsis; log `warn` with ratio; show settings-tab banner. If product later prefers reject-and-warn, Y4/C1 assertions are localized and cheap to swap. Flag to product in review. |
| 5 | Character-count / token-count UI hint (REQ-002 Open Q4) is not committed. | Ship the over-budget banner only (C2) in this story; defer a live character/token meter to a follow-up story if product wants it. |
| 6 | `IChatPort` adapters could silently regress (e.g. merging two system messages into one, or reordering for vendor quirks). | New contract test (Y7) and integration test (Y8) with hermetic Ollama fixture guard against silent regression; both are binding evidence. |
| 7 | Mid-stream settings change behavior is not specified (REQ-002 Open Q6). | Adopt the conservative interpretation implied by ADR-011 Decision 4: in-flight turns continue with the values they were dispatched with; the next turn picks up new values. Documented as a test note on B4. |

---

## Implementation Order

1. `src/core/domain/types.ts` — extend `ChatRequestPayload` with the three new fields (covers the shape prerequisite for A1, B1).
2. `src/plugin/settings/SettingsTab.ts` — add the two settings, defaults, textareas, guide link, and over-budget warning (covers A1, A2, Y5, C2).
3. **Verify** — run `tests/plugin/settings/SettingsTab.chatPrompts.test.ts` in red-first mode, then green.
4. `src/plugin/ui/ChatView.ts` — read current settings on each dispatch; include fields on payload when non-empty (covers B1, S8, S9, S12).
5. **Verify** — run `tests/plugin/ui/ChatView.payload.test.ts`.
6. `src/sidecar/adapters/chatProviderMessages.ts` — insert user prompts in canonical ADR-011 order; treat empty/whitespace as absent; enforce combined budget and never truncate built-in policy; log `warn` on truncation (covers B2, B3, B4, B5, C1, Y3, Y4, Y6).
7. **Verify** — run `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts`.
8. `src/sidecar/runtime/SidecarRuntime.ts` and `src/core/workflows/ChatWorkflow.ts` — forward the new payload fields into `runChatStream` options and message assembly on every turn, including first turn after new-conversation reset (covers B4, S10).
9. **Verify** — run `tests/core/workflows/ChatWorkflow.userPrompts.test.ts`; confirm no sidecar code reads the two settings from storage (`npm run check:chat-prompt-transport` / Y2 script).
10. `tests/contract/chat-port.contract.ts` — author the generic `IChatPort` contract suite and wire it into the existing chat-adapter test files (covers Y7).
11. `tests/sidecar/adapters/OllamaChatAdapter.userPrompts.integration.test.ts` — author the hermetic integration test with recorded Ollama fixture asserting wire-body ordering (covers Y8).
12. **Verify** — run contract + integration tests against both existing adapters; confirm no adapter code changed.
13. **Final verify** — `npm run build`, `npm run lint`, full test suite, `npm run check:boundaries`, `/review-story CHAT-4` (Z6). Confirm the story's summary line reports zero high/critical findings on the changed surface.

---

*Created: 2026-04-20 | Story: CHAT-4 | Epic: 5 — Retrieval, search workflow, and chat workflow*
