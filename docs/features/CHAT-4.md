# CHAT-4: User chat system prompt + vault-organization prompt

**Story**: Add two persisted plugin settings — `chatSystemPrompt` (persona/style) and `vaultOrganizationPrompt` (how notes are organized) — surface them in the settings tab, flow them through the `chat` message payload, and have the sidecar merge them into provider messages in the order defined by [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) on **every** chat request. Combined system-message budget is enforced to avoid crowding out retrieval context.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Planned

---

## 1. Summary

[REQUIREMENTS §6](../requirements/REQUIREMENTS.md) and [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) require the built-in grounding policy plus two user-controlled system messages:

- `chatSystemPrompt` — persona, tone, writing style; e.g. "Answer in British English. Prefer bullet lists over prose."
- `vaultOrganizationPrompt` — how this user's vault is structured; e.g. "Daily notes live in `Daily/` as `YYYY-MM-DD.md`. Journal entries use `#journal`. Job-search activity is tagged `#jobsearch` and lives in daily notes under `## Job search`."

The vault-organization prompt is critical for queries like "summarize my job-search activity over the last two weeks" — without it the assistant has no way to translate the user's mental model into retrieval intent. [CHAT-3](CHAT-3.md) ships the built-in policy and the insufficient-evidence path; this story extends the message-assembly layer to carry and apply the two user prompts per request.

Settings persist in the normal plugin data path ([ADR-004](../decisions/ADR-004-per-vault-index-storage.md)); they are **not** secrets and are sent with every chat request so the sidecar never caches them.

**Prerequisites:** [CHAT-3](CHAT-3.md), [PLG-4](PLG-4.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                      | Why it binds this story                                                            |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [docs/decisions/ADR-011-vault-only-chat-grounding.md](../decisions/ADR-011-vault-only-chat-grounding.md) | Defines ordering and per-request transport of user prompts.                        |
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md)           | Message assembly stays upstream of `IChatPort`; adapters remain provider-neutral.  |
| [docs/decisions/ADR-004-per-vault-index-storage.md](../decisions/ADR-004-per-vault-index-storage.md)     | Settings persisted per vault via the plugin's data path.                           |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Settings `chatSystemPrompt` and `vaultOrganizationPrompt` are persisted by the plugin; defaults are empty strings (no behavior change until user populates them).
2. **Y2** — Both values are sent in the `chat` payload on **every** request. The sidecar never reads them from settings directly and never caches them across requests.
3. **Y3** — Message ordering matches [ADR-011 §2](../decisions/ADR-011-vault-only-chat-grounding.md#decision): built-in policy → `vaultOrganizationPrompt` (if non-empty) → `chatSystemPrompt` (if non-empty) → retrieval context system (if non-empty) → conversation history → current user turn. Adapters must not reorder.
4. **Y4** — Combined system-message token budget is bounded: implementer sets a ceiling (e.g. 1,200 tokens for built-in + user prompts combined); when exceeded, user prompts are truncated with a logged warning — built-in policy is never truncated.
5. **Y5** — Settings tab exposes both fields as multi-line text inputs with help text pointing at [docs/guides/chat-behavior-tuning.md](../guides/chat-behavior-tuning.md).
6. **Y6** — Empty string and whitespace-only values are treated as "not set" (no empty system message appended).

---

## 5. API Endpoints + Schemas

Extend the chat payload (in [`src/core/domain/types.ts`](../../src/core/domain/types.ts)):

```ts
export interface ChatRequestPayload {
  messages: ChatMessage[];
  apiKey?: string;
  context?: string;
  timeoutMs?: number;
  systemPrompt?: string;              // new — chatSystemPrompt
  vaultOrganizationPrompt?: string;   // new — vaultOrganizationPrompt
  groundingPolicyVersion?: string;    // new — echoes plugin-selected version (see ADR-011)
}
```

Extend [`SidecarPluginSettings`](../../src/plugin/settings/SettingsTab.ts) with the two string fields (defaults: `''`). Update the settings loader and the settings tab UI.

Extend [`buildGroundedMessages`](../../src/sidecar/adapters/chatProviderMessages.ts) (added in CHAT-3) to honor `systemPrompt` and `vaultOrganizationPrompt` per Y3.

---

## 6. Frontend Flow

Settings tab gains two new fields; ChatView is unchanged beyond CHAT-3's insufficient-evidence rendering.

### 6a. Component / Data Hierarchy

```
SettingsTab
├── existing provider / retrieval settings…
└── "Chat grounding" section (new)
    ├── Vault organization prompt (textarea, multi-line)
    └── Chat system prompt (textarea, multi-line)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature                               | State                                  | Notes                                                    |
| ---------------- | ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `SettingsTab`    | read/write `settings.chatSystemPrompt`, `settings.vaultOrganizationPrompt` | debounced save | Show character count hint; link to chat-behavior-tuning. |

### 6c. States (Loading / Error / Empty / Success)

| State             | UI Behavior                                                                |
| ----------------- | -------------------------------------------------------------------------- |
| Empty             | Placeholder explains purpose; link to guide with examples.                 |
| Populated         | Saved on blur / debounce; no visible confirmation beyond existing pattern. |
| Over budget       | Settings tab shows a non-blocking warning ("prompt will be truncated at request time"). |

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                                  | Purpose                                                 |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts`     | Ordering and no-op behavior when user prompts empty.    |
| 2   | `tests/plugin/settings/SettingsTab.chatPrompts.test.ts`               | Settings round-trip + truncation warning UI behavior.  |

### Files to MODIFY

| #   | Path                                                        | Change                                                                                |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/types.ts`                                  | Extend chat payload with `systemPrompt`, `vaultOrganizationPrompt`, `groundingPolicyVersion`. |
| 2   | `src/plugin/settings/SettingsTab.ts`                        | Add `chatSystemPrompt` and `vaultOrganizationPrompt` UI; defaults and persistence.    |
| 3   | `src/plugin/ui/ChatView.ts`                                 | Include both settings values on every `streamChat` payload.                           |
| 4   | `src/sidecar/adapters/chatProviderMessages.ts`              | Insert user prompts per Y3; enforce combined budget per Y4.                           |
| 5   | `src/sidecar/runtime/SidecarRuntime.ts`                     | Forward new fields from transport payload into `runChatStream` options.               |
| 6   | `src/core/workflows/ChatWorkflow.ts`                        | Accept user prompts in options; pass through to message assembly.                     |
| 7   | `docs/guides/chat-behavior-tuning.md`                       | Referenced here; authored by companion doc task.                                      |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — unchanged; prompts are assembled upstream.

---

## 8. Acceptance Criteria Checklist

### Phase A: Settings persistence

- [ ] **A1** — `chatSystemPrompt` and `vaultOrganizationPrompt` round-trip through plugin settings (read on load, saved on change).
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A1_roundtrip`
- [ ] **A2** — Defaults are empty strings; plugin first run does not add any prompt noise.
  - Evidence: `tests/plugin/settings/SettingsTab.chatPrompts.test.ts::A2_defaults_empty`

### Phase B: Transport + assembly

- [ ] **B1** — `streamChat` payload includes both fields whenever the setting is non-empty; omits empty strings.
  - Evidence: `tests/plugin/ui/ChatView.payload.test.ts::B1_payload_includes_prompts`
- [ ] **B2** — `buildGroundedMessages` emits system messages in the order: built-in policy → vault-organization → chat-system → retrieval context.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B2_order`
- [ ] **B3** — Empty or whitespace-only user prompt values produce **no** extra system message.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::B3_empty_prompts_noop`

### Phase C: Budget

- [ ] **C1** — When combined user prompts exceed the budget, user prompt text is truncated (suffix ellipsis), built-in policy is preserved verbatim, and a `warn`-level log entry fires with the truncation ratio.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.userPrompts.test.ts::C1_truncation`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — Core workflow still has no forbidden imports after signature changes.
  - Evidence: `npm run check:boundaries`
- [ ] **Y2** — Sidecar never reads `chatSystemPrompt` / `vaultOrganizationPrompt` from settings storage; values always come from the payload.
  - Evidence: `rg "chatSystemPrompt|vaultOrganizationPrompt" src/sidecar` returns only payload-type references (no settings reads).

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — **N/A**
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations; payload redacts nothing from the user prompts (they are user-owned, not secrets), but log sampling should cap very long prompts.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                                | Mitigation                                                                                                   |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Users write prompts that contradict the grounding policy       | Built-in policy appears **first**; explicit guidance in [chat-behavior-tuning.md](../guides/chat-behavior-tuning.md). |
| 2   | Very long vault-organization prompts crowd out retrieval context | Combined budget with truncation; guide recommends short, factual conventions.                                |
| 3   | Sensitive content in a "personal" vault-organization prompt    | Plugin never logs full prompt at `info`; `debug` only, and only for local troubleshooting.                   |

---

## Implementation Order

1. Extend `ChatRequestPayload` and settings types.
2. Extend settings tab + persistence (A1, A2).
3. Thread prompts through `ChatView` → transport (B1).
4. Extend `buildGroundedMessages` ordering + budget (B2, B3, C1).
5. Update runtime / workflow to forward new options.
6. Tests per phases; final verify (`build`, `lint`, `test`).

---

_Created: 2026-04-16 | Story: CHAT-4 | Epic: 5 — Retrieval, search workflow, and chat workflow_
