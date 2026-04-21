# CHAT-3: Always-on grounding policy + insufficient-evidence response

**Story**: Make the vault-only grounding policy **non-optional** at the message-assembly layer: every chat request built by the sidecar must prepend a built-in grounding system message, and when retrieval produces no usable context the workflow must emit a deterministic **insufficient-evidence** terminal stream (empty `sources`, structured marker) instead of letting the model answer from training data. Replace the conditional early return in [`buildMessagesWithContext`](../../src/sidecar/adapters/chatProviderMessages.ts) and extend `ChatWorkflow` / `ChatView` accordingly.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Complete

---

## 1. Summary

[REQ-001 — Always-on vault-only chat grounding policy and insufficient-evidence response](../requirements/REQ-001-grounding-policy.md) is the authoritative refined requirements file for this story. It encodes the scenarios S1–S10 that this story is expected to make observable, and its source traces to [REQUIREMENTS §1](../requirements/REQUIREMENTS.md) ("chat answers use only the vault as knowledge"), [§6](../requirements/REQUIREMENTS.md) ("Grounding policy (non-optional)"), [§10](../requirements/REQUIREMENTS.md) ("Insufficient-evidence state (iter-2)"), and [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md).

The current pipeline only injects the `VAULT_CONTEXT_PREFIX` system message when retrieval returns non-empty context ([`buildMessagesWithContext`](../../src/sidecar/adapters/chatProviderMessages.ts)). When retrieval is empty — a common case for users whose notes *do* contain the answer but retrieval missed (RET-4/RET-5/RET-6 address recall) — the model receives the conversation only and produces generic "I don't have your notes; paste them" replies. This story delivers ADR-011's always-on grounding policy and deterministic insufficient-evidence terminal stream for the built-in policy, and extends `ChatView` to render the insufficient-evidence state distinctly.

**Scenario coverage.** All ten REQ-001 scenarios (S1–S10) are in scope for this story and are mapped to acceptance tests in §8a. Note on S7 (user-supplied `chatSystemPrompt` / `vaultOrganizationPrompt` do not override grounding): the *settings UI surface* for those user prompts is deferred to [CHAT-4](CHAT-4.md) per REQ-001 §2 and ADR-011 *Explicit non-decisions*, but S7's **grounding-ordering guarantee** is enforced here by wiring the `GroundingContext` shape so that any values passed through the reserved `systemPrompt` / `vaultOrganizationPrompt` slots are assembled *after* the built-in policy and are verified by unit tests. No REQ-001 Sn is declared out-of-scope.

**Prerequisites:** [CHAT-1](CHAT-1.md), [CHAT-2](CHAT-2.md), [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) **Accepted**.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                      | Why it binds this story                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Mandates always-on built-in grounding policy, fixed message ordering, and the deterministic product-owned insufficient-evidence terminal stream. This story is the implementation of ADR-011 §Decision 1–5.   |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md)           | Decision 5 fixes grounding assembly *upstream* of `IChatPort`; adapters receive a fully-assembled `messages` array and must not re-order, drop, or inject system messages. Keeps providers provider-neutral.    |
| [`docs/decisions/ADR-003-phased-retrieval-strategy.md`](../decisions/ADR-003-phased-retrieval-strategy.md) | Defines the retrieval signal the workflow inspects when deciding insufficient-evidence (zero usable hits).                                                                                                    |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Section 4b (Ports & Adapters) lists every port/adapter this story creates or modifies, or states explicitly that no integration boundaries are touched
- [ ] Section 8a (Test Plan) is filled and **every AC ID** (including Phase Y and Phase Z) is referenced by at least one planned test row
- [ ] For every adapter in Section 4b, Section 8a contains both a **contract test against the port** and an **integration test against the real backing service** (no mock of the boundary the adapter owns), and Phase Y has a `(binding)` criterion citing the integration test file
- [ ] Every Gherkin `Sn` ID from the linked refined requirements ([`docs/requirements/REQ-001-grounding-policy.md`](../requirements/REQ-001-grounding-policy.md)) is mapped to at least one acceptance test row in Section 8a — or the story explicitly states why a given `Sn` is out of scope here
- [ ] Phase Y includes at least one criterion with **non-mock** evidence where wrong-stack substitution is a risk

*Planning note:* The built-in policy **copy** is owned by the implementer; reviewers should treat copy as adjustable until Phase A tests pin it behind a `groundingPolicyVersion` constant. REQ-001 §7 tracks the open question on default copy — tests reference the named constant rather than literal text.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `buildMessagesWithContext` (or its successor `buildGroundedMessages`) prepends the built-in grounding system message on **every** call, regardless of whether `retrievalContext` is empty; the current `ctx === ''` early return is removed.
2. **Y2** — Provider message ordering matches [ADR-011 §Decision 2](../decisions/ADR-011-vault-only-chat-grounding.md#decision): built-in policy system → `vaultOrganizationPrompt` system (when set) → `chatSystemPrompt` system (when set) → vault-context system (when non-empty) → prior conversation history → current user turn.
3. **Y3** — When `runChatStream` receives zero usable retrieval hits (workflow-defined threshold: zero `SearchResult`s), it **must not** call `IChatPort.complete`. It emits a product-owned insufficient-evidence `delta` string (or sequence) followed by a terminal event marking `sources: []` and `groundingOutcome: 'insufficient_evidence'`.
4. **Y4** — The built-in grounding policy text is declared as a **named constant** (e.g. `GROUNDING_POLICY_V1`) co-located with `chatProviderMessages.ts`, and the assembled system message includes the policy version identifier (logged; not shown to user).
5. **Y5** — `ChatView` renders the insufficient-evidence state **distinctly** from a normal assistant reply (at minimum: a dedicated CSS class and no "Sources:" footer when `sources.length === 0 && groundingOutcome === 'insufficient_evidence'`).
6. **Y6** — Core workflow remains portable: no new imports of `obsidian`, `better-sqlite3`, or `src/sidecar/**` from `src/core/workflows/ChatWorkflow.ts`.

---

## 4b. Ports & Adapters

This story does **not** introduce a new adapter. Per [ADR-011 §Explicit non-decisions](../decisions/ADR-011-vault-only-chat-grounding.md#explicit-non-decisions) and [ADR-005 §Decision 5](../decisions/ADR-005-provider-abstraction.md), grounding is assembled *upstream* of `IChatPort`; the existing `OpenAIChatAdapter` and `OllamaChatAdapter` remain unchanged. The port is still listed below for traceability because this story introduces a new contract obligation on the port (adapters must accept the fully-assembled `messages` array unchanged — no reordering, no re-injection of system messages), which requires contract-level binding evidence.

| Port name  | Port file                      | Adapter(s)                                                                                                                                  | Real backing service / fixture                                                                                                                                                                                     | Notes                                                                                                                             |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `IChatPort` | `src/core/ports/IChatPort.ts`  | `OpenAIChatAdapter` (`src/sidecar/adapters/OpenAIChatAdapter.ts`), `OllamaChatAdapter` (`src/sidecar/adapters/OllamaChatAdapter.ts`) — unchanged by this story | Contract: generic contract suite (`tests/contract/IChatPort.contract.ts`) run against the real `OpenAIChatAdapter` / `OllamaChatAdapter` with a recorded in-memory provider fixture. Integration: `ChatWorkflow` wired to a faithful in-process `IChatPort` implementation that captures the exact `messages` array produced by the workflow — no mock of the boundary under test. | No new adapter is introduced; binding evidence is contract-level. Asserts adapters do not reorder / drop / inject system messages. |

---

## 5. API Endpoints + Schemas

No new sidecar routes. This story extends the streaming payload shape and introduces a named grounding-context type.

Extend `ChatStreamDone` (in [`src/core/domain/types.ts`](../../src/core/domain/types.ts)):

```ts
export type GroundingOutcome = 'answered' | 'insufficient_evidence';

export interface ChatStreamDone {
  type: 'done';
  sources: Source[];
  groundingOutcome: GroundingOutcome; // new
  groundingPolicyVersion: string;     // new (e.g. 'v1')
}
```

Co-locate the policy in [`src/sidecar/adapters/chatProviderMessages.ts`](../../src/sidecar/adapters/chatProviderMessages.ts):

```ts
export const GROUNDING_POLICY_VERSION = 'v1';
export const GROUNDING_POLICY_V1 = `You are an assistant that answers only from the user's Obsidian vault... [full copy per ADR-011]`;

export interface GroundingContext {
  systemPrompt?: string;              // reserved slot (settings UI lands in CHAT-4; ordering guarantee enforced here)
  vaultOrganizationPrompt?: string;   // reserved slot (settings UI lands in CHAT-4; ordering guarantee enforced here)
  retrievalContext: string;           // may be empty
}

export function buildGroundedMessages(
  messages: ChatMessage[],
  grounding: GroundingContext,
): ChatMessage[];
```

The default `buildMessagesWithContext(messages, context)` is preserved as a thin wrapper that builds a minimal `GroundingContext` for backward compatibility during migration.

---

## 6. Frontend Flow

Chat pane must render the insufficient-evidence terminal state.

### 6a. Component / Data Hierarchy

```
ChatView
└── messages[]
    └── AssistantMessage
        ├── body (delta-accumulated text)
        └── groundingOutcome marker (renders "No matching notes found" chip when 'insufficient_evidence')
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature                              | State                           | Notes                                                 |
| ---------------- | ---------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `ChatView`       | reads `ChatStreamChunk` from `streamChat(...)` | `messages`, `groundingOutcome`  | Persist `groundingOutcome` on the assistant message.  |

### 6c. States (Loading / Error / Empty / Success)

| State                  | UI Behavior                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Answered (sources > 0) | Normal assistant bubble + source pills.                                                              |
| Insufficient-evidence  | Assistant bubble with distinct style; no source pills; product-owned copy ("No matching notes…").    |
| Cancelled / Timeout    | Existing CHAT-2 behavior; unaffected.                                                                |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path                                                                      | Purpose                                                                                            |
|---|---------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| 1 | `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts`           | Unit tests: policy always prepended; ordering; user-prompt-slot ordering; empty-context behavior.  |
| 2 | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts`          | Workflow emits insufficient-evidence terminal without calling `IChatPort.complete`; answered path. |
| 3 | `tests/plugin/ui/ChatView.insufficientEvidence.test.ts`                   | DOM test: distinct state + no sources footer on insufficient_evidence outcome.                     |
| 4 | `tests/contract/IChatPort.contract.ts`                                    | Generic `IChatPort` contract suite: adapters must not reorder / drop / inject system messages.     |
| 5 | `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts`    | Integration: `ChatWorkflow` wired end-to-end through `buildGroundedMessages` + a faithful `IChatPort` fixture; asserts the fully-assembled messages array (policy first, then user-prompt slots, then context, then history, then user turn). |
| 6 | `tests/integration/chatWorkflowDeps.ts`                                 | Test-only wiring: `buildGroundedMessages` injected into `ChatWorkflowDeps` (FND-3: not under `tests/core/`). |
| 7 | `tests/shims/obsidian.ts`                                                 | Vitest/runtime shim + DOM helpers so plugin UI tests resolve `obsidian` (types-only npm package). |

### Files to MODIFY

| # | Path                                             | Change                                                                                            |
|---|--------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1 | `src/sidecar/adapters/chatProviderMessages.ts`   | Replace conditional injection with `buildGroundedMessages`; export `GROUNDING_POLICY_V1` + version. |
| 2 | `src/core/workflows/ChatWorkflow.ts`             | Detect empty retrieval → emit insufficient-evidence stream; thread `groundingOutcome`.             |
| 3 | `src/core/domain/types.ts`                       | Add `GroundingOutcome`, extend `ChatStreamDone`.                                                  |
| 4 | `src/sidecar/runtime/SidecarRuntime.ts`          | Pass `groundingOutcome` / `groundingPolicyVersion` on `done` event.                                |
| 5 | `src/plugin/ui/ChatView.ts`                      | Render insufficient-evidence state distinctly; hide sources when `sources.length === 0`.          |
| 6 | `tests/sidecar/runtime/SidecarRuntime.test.ts`   | Cover terminal shape with new fields.                                                             |
| 7 | `src/sidecar/stdio/stdioServer.ts`               | NDJSON chat completion line includes `groundingOutcome` + `groundingPolicyVersion`.               |
| 8 | `src/sidecar/http/httpServer.ts`                 | NDJSON chat completion line includes `groundingOutcome` + `groundingPolicyVersion`.               |
| 9 | `src/plugin/client/StdioTransportAdapter.ts`     | Parse extended `done` payload from sidecar.                                                       |
| 10 | `src/plugin/client/HttpTransportAdapter.ts`       | Parse extended `done` payload from sidecar.                                                       |
| 11 | `vitest.config.ts`                                | `obsidian` → shim alias; include `IChatPort` contract path.                                      |
| 12 | `package.json`                                   | `happy-dom` devDependency for `ChatView` UI tests.                                                 |
| 13 | `tests/core/workflows/ChatWorkflow.test.ts` and related workflow tests | Inject `buildGroundedMessages` via `tests/integration/chatWorkflowDeps.ts`; update expectations. |
| 14 | `tests/sidecar/adapters/OpenAIChatAdapter.test.ts`, `OllamaChatAdapter.test.ts` | Expect built-in policy prefix when non-empty `context` is passed to adapters.              |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — signature unchanged; grounding is assembled upstream (per [ADR-011 §Explicit non-decisions](../decisions/ADR-011-vault-only-chat-grounding.md#explicit-non-decisions) and [ADR-005 §Decision 5](../decisions/ADR-005-provider-abstraction.md)). A new contract test suite pins the unchanged obligation.
- `src/sidecar/adapters/OpenAIChatAdapter.ts`, `src/sidecar/adapters/OllamaChatAdapter.ts` — providers receive fully-assembled `messages`; no adapter code changes. Both must continue to pass the new contract suite.

---

## 8. Acceptance Criteria Checklist

### Phase A: Message assembly

- [x] **A1** — `buildGroundedMessages` prepends the built-in policy system message when `retrievalContext === ''`
  - The first message in the returned array is a `system` role whose content references `GROUNDING_POLICY_V1` (compared by reference to the exported constant, not by literal text).
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A1_policy_always_present_on_empty_context(vitest)`

- [x] **A2** — Ordering matches ADR-011 §Decision 2 on every call
  - With `systemPrompt`, `vaultOrganizationPrompt`, and `retrievalContext` all populated, the returned array ordering is: `[policy-system, vaultOrganizationPrompt-system, chatSystemPrompt-system, vault-context-system, ...history, currentUserTurn]`. Optional slots are omitted when their input is empty, but relative order of the remaining messages is preserved.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A2_ordering_policy_first_then_user_prompts_then_context(vitest)`

### Phase B: Insufficient-evidence path

- [x] **B1** — When `runChatStream` receives zero retrieval hits, `IChatPort.complete` is **not** invoked
  - A fake `IChatPort` whose `complete()` increments a counter asserts the counter is `0` after the stream closes.
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B1_no_provider_call_on_zero_hits(vitest)`

- [x] **B2** — Terminal event carries `sources: []`, `groundingOutcome: 'insufficient_evidence'`, `groundingPolicyVersion: 'v1'`
  - The final chunk from the async iterator is a `done` event with exactly `{ sources: [], groundingOutcome: 'insufficient_evidence', groundingPolicyVersion: 'v1' }`. No fabricated sources appear.
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B2_terminal_shape_marks_insufficient_evidence(vitest)`

- [x] **B3** — When retrieval returns ≥ 1 hit, existing answered flow still fires and terminal carries `groundingOutcome: 'answered'`
  - With a non-empty search result set, `IChatPort.complete` is invoked exactly once, deltas stream through, and the terminal event carries `{ groundingOutcome: 'answered', groundingPolicyVersion: 'v1', sources: [...] }` with `sources.length >= 1`.
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B3_answered_path_unchanged(vitest)`

- [x] **B4** — Insufficient-evidence delta names at least one concrete narrowing avenue
  - The concatenated `delta` text on the insufficient-evidence path contains at least one of: "folder", "tag", "date", or "narrow" (case-insensitive). The test references the constant-defined delta copy, not literal wording beyond these anchor keywords, so copy can evolve without breaking the test.
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B4_delta_includes_narrowing_hint(vitest)`

### Phase C: UI rendering

- [x] **C1** — `ChatView` renders a distinct state (CSS class + no sources footer) when the terminal carries `groundingOutcome: 'insufficient_evidence'`
  - DOM assertion: the rendered assistant message node carries the `insufficient-evidence` CSS class; no `.sources-footer` element is rendered; no `.source-pill` nodes are present; normal-answer chrome is absent.
  - Evidence: `tests/plugin/ui/ChatView.insufficientEvidence.test.ts::C1_distinct_state_no_sources_footer(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `buildGroundedMessages` prepends the policy on every call (no conditional early return)
  - Verified by the unit test pinning A1, and statically by the absence of any `if (retrievalContext === '')` early-return branch in `buildGroundedMessages`.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A1_policy_always_present_on_empty_context(vitest)`

- [x] **Y2** — **(binding)** Provider message ordering matches ADR-011 §Decision 2
  - Verified by the unit test pinning A2.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A2_ordering_policy_first_then_user_prompts_then_context(vitest)`

- [x] **Y3** — **(binding)** Empty retrieval path does not invoke `IChatPort.complete`
  - Verified by the zero-call assertion in the B1 unit test (fake port records call count).
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B1_no_provider_call_on_zero_hits(vitest)`

- [x] **Y4** — **(binding)** `GROUNDING_POLICY_V1` lives in the sidecar adapter module (not `src/core/`) and `GROUNDING_POLICY_VERSION` is logged on every chat request
  - Static grep: `rg "GROUNDING_POLICY_V1" src/core` returns zero matches; `rg "GROUNDING_POLICY_V1\|GROUNDING_POLICY_VERSION" src/sidecar/adapters/chatProviderMessages.ts` returns at least one match each.
  - Evidence: `rg "GROUNDING_POLICY_V1" src/core` returns zero matches; `rg "GROUNDING_POLICY_VERSION" src/sidecar/adapters/chatProviderMessages.ts` returns ≥ 1 match.

- [x] **Y5** — **(binding)** `ChatView` renders insufficient-evidence state with a dedicated CSS class and no sources footer
  - Verified by the DOM test pinning C1.
  - Evidence: `tests/plugin/ui/ChatView.insufficientEvidence.test.ts::C1_distinct_state_no_sources_footer(vitest)`

- [x] **Y6** — **(binding)** `src/core/workflows/ChatWorkflow.ts` has no new imports from `obsidian`, `better-sqlite3`, or `src/sidecar/`
  - Evidence: `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [x] **Y7** — **(binding)** `IChatPort` implementations receive the fully-assembled messages array unchanged (no reordering / drop / injection of system messages upstream of the port)
  - Contract suite exercises both real adapters; integration test asserts the `messages` array captured at the port boundary when called via `ChatWorkflow` matches the expected ADR-011 ordering byte-for-byte against the constants produced by `buildGroundedMessages`.
  - Evidence: `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts::Y7_workflow_passes_full_message_list_to_real_port(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `rg "\\bany\\b" src/core/domain/types.ts src/core/workflows/ChatWorkflow.ts src/sidecar/adapters/chatProviderMessages.ts src/sidecar/runtime/SidecarRuntime.ts src/plugin/ui/ChatView.ts` returns no true hits (only type-name contexts such as `AnyOf` are allowed)
- [x] **Z4** — All client imports from shared use `@shared/types` alias — **N/A for this repo** (Obsidian plugin layout uses `@src/` + local core types; no `shared/` workspace)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines; `groundingPolicyVersion` is logged on every chat request
  - Evidence: `rg "groundingPolicyVersion" src/sidecar/runtime/SidecarRuntime.ts` returns ≥ 1 match in a logger call site
- [x] **Z6** — `/review-story CHAT-3` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output)
  - Evidence: `/review-story CHAT-3` output summary line

---

## 8a. Test Plan

| #  | Level       | File::test name                                                                                                                             | Covers AC       | Covers Sn      | Notes                                                                                                                                                                 |
|----|-------------|---------------------------------------------------------------------------------------------------------------------------------------------|-----------------|----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | unit        | `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A1_policy_always_present_on_empty_context`                                  | A1, Y1          | S3, S6         | Empty `retrievalContext` → first message is the policy system message; also exercises the "new conversation" first-turn shape (S6).                                    |
| 2  | unit        | `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A2_ordering_policy_first_then_user_prompts_then_context`                    | A2, Y2          | S3, S7         | Populated `systemPrompt` + `vaultOrganizationPrompt` + `retrievalContext`; verifies user-prompt slots sit after the built-in policy and cannot move to position 0 (S7). |
| 3  | unit        | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B1_no_provider_call_on_zero_hits`                                          | B1, Y3          | S2, S10        | Fake `IChatPort` records 0 calls; proves the reply is product-owned, not model-generated (S10), and fires on zero hits (S2).                                           |
| 4  | unit        | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B2_terminal_shape_marks_insufficient_evidence`                             | B2              | S2, S9         | Terminal event: `sources: []`, `groundingOutcome: 'insufficient_evidence'`, `groundingPolicyVersion: 'v1'`; asserts internal consistency — no fabricated citations (S9). |
| 5  | unit        | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B4_delta_includes_narrowing_hint`                                          | B4              | S8             | Delta text contains at least one of "folder" / "tag" / "date" / "narrow"; asserts S8's "how to narrow" guidance.                                                        |
| 6  | unit        | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B3_answered_path_unchanged`                                                | B3              | S1             | ≥ 1 retrieval hit → `IChatPort.complete` invoked once; terminal event carries `groundingOutcome: 'answered'` and populated `sources`.                                   |
| 7  | unit        | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::S5_followup_turn_remains_grounded`                                         | B1, B3          | S5             | Multi-turn: first turn answered (hits), second turn with zero hits still emits insufficient-evidence terminal; grounding persists per-turn.                             |
| 8  | ui          | `tests/plugin/ui/ChatView.insufficientEvidence.test.ts::C1_distinct_state_no_sources_footer`                                                | C1, Y5          | S4, S9         | DOM assertion: distinct CSS class; no `.sources-footer`; no source pills; cannot be confused with an answered reply.                                                    |
| 9  | contract    | `tests/contract/IChatPort.contract.ts::IChatPort_preserves_assembled_messages_unchanged`                                                    | Y7              | S1, S3, S10    | Generic suite exercised against `OpenAIChatAdapter` and `OllamaChatAdapter`; asserts the `messages` array the adapter forwards to its provider SDK equals the input array (no reorder, no drop, no injected system messages). |
| 10 | integration | `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts::Y7_workflow_passes_full_message_list_to_real_port`                    | Y7              | S1, S3         | Wires real `buildGroundedMessages` + real `ChatWorkflow` + a faithful in-process `IChatPort` implementation (no mocked boundary) that captures the exact `messages` array; verifies ADR-011 §Decision 2 ordering end-to-end. |
| 11 | unit        | `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::Y4_policy_constant_in_sidecar_and_version_exported`                         | Y4              | —              | Imports and asserts on the exported constants; backed by a static `rg` check as primary evidence.                                                                       |
| 12 | static      | `scripts/check-source-boundaries.mjs::Y6_core_stays_portable(npm run check:boundaries)`                                                     | Y6              | —              | Boundary script fails build if `src/core/workflows/ChatWorkflow.ts` imports from `obsidian`, `better-sqlite3`, or `src/sidecar/**`.                                      |
| 13 | gate        | `package.json::Z1_build(npm run build)`                                                                                                     | Z1              | —              | TypeScript + esbuild clean.                                                                                                                                            |
| 14 | gate        | `package.json::Z2_lint(npm run lint)`                                                                                                       | Z2              | —              | ESLint clean or only pre-existing warnings.                                                                                                                            |
| 15 | static      | `scripts/check-no-any.sh::Z3_no_any(rg)`                                                                                                    | Z3              | —              | Grep-based check over new/modified files for banned `any`.                                                                                                             |
| 16 | review      | `docs/features/CHAT-3.md::Z4_shared_types_alias_not_applicable`                                                                             | Z4              | —              | Explicitly N/A for this repo layout (documented in §8 Phase Z).                                                                                                         |
| 17 | review      | `src/sidecar/runtime/SidecarRuntime.ts::Z5_logs_grounding_policy_version(rg)`                                                               | Z5              | —              | Grep asserts a logger call site references `groundingPolicyVersion`.                                                                                                   |
| 18 | gate        | `/review-story CHAT-3::Z6_review_clean`                                                                                                     | Z6              | —              | `/review-story` report — zero high/critical TEST/SEC/REL/API findings on the changed surface.                                                                           |

**Sn coverage audit (all REQ-001 scenarios):** S1 (rows 6, 9, 10), S2 (rows 3, 4), S3 (rows 1, 2, 9, 10), S4 (row 8), S5 (row 7), S6 (row 1), S7 (row 2), S8 (row 5), S9 (rows 4, 8), S10 (rows 3, 9). No REQ-001 Sn is out of scope.

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff                                                          | Mitigation                                                                                                                                      |
|---|--------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Insufficient-evidence fires when retrieval missed existing notes         | RET-4/RET-5/RET-6 raise recall; copy must acknowledge "try narrower query / folder / tag" rather than assert vault emptiness (enforced by B4).   |
| 2 | Policy copy evolves, breaking pinned tests                               | Tests assert against the **constant reference** and anchor keywords, not literal text; evolve `GROUNDING_POLICY_VERSION` when wording changes materially. |
| 3 | Some providers strip early system messages when over context window      | Keep built-in policy short (per ADR-011 *Consequences / Negative*); CHAT-4 enforces a combined system-message token budget.                      |
| 4 | CHAT-4 has not yet shipped the settings UI for `chatSystemPrompt` / `vaultOrganizationPrompt` | `GroundingContext` reserves those slots now so S7's ordering guarantee is enforceable today; CHAT-4 only wires the settings inputs. |
| 5 | Contract test on `IChatPort` requires adapters to pass a new suite        | Run the new contract suite against both real adapters in the same PR; failures indicate an existing adapter already reorders messages and must be fixed before merge. |

---

## Implementation Order

1. `src/core/domain/types.ts` — add `GroundingOutcome`, extend `ChatStreamDone` (covers B2).
2. `src/sidecar/adapters/chatProviderMessages.ts` — add `GROUNDING_POLICY_V1`, `GROUNDING_POLICY_VERSION`, `GroundingContext`, `buildGroundedMessages`; keep `buildMessagesWithContext` as a wrapper (covers A1, A2, Y1, Y2, Y4).
3. **Verify** — run `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts` red → green.
4. `tests/contract/IChatPort.contract.ts` — author the generic contract suite and wire it against both `OpenAIChatAdapter` and `OllamaChatAdapter` (covers Y7).
5. `src/core/workflows/ChatWorkflow.ts` — detect empty retrieval, emit insufficient-evidence stream, thread `groundingOutcome` + `groundingPolicyVersion` (covers B1, B3, B4, Y3).
6. **Verify** — run `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts` red → green; run `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts` (covers Y7).
7. `src/sidecar/runtime/SidecarRuntime.ts` — propagate new terminal fields; add `groundingPolicyVersion` to the per-request log line (covers Z5).
8. `src/plugin/ui/ChatView.ts` — render distinct insufficient-evidence state; hide sources footer when `sources.length === 0 && groundingOutcome === 'insufficient_evidence'` (covers C1, Y5).
9. **Verify** — run `tests/plugin/ui/ChatView.insufficientEvidence.test.ts`.
10. **Final verify** — `npm run build`, `npm run lint`, `npm run check:boundaries`, full `vitest` run, then `/review-story CHAT-3` (covers Z1, Z2, Y6, Z6).

---

*Created: 2026-04-16 | Rewritten: 2026-04-20 | Story: CHAT-3 | Epic: 5 — Retrieval, search workflow, and chat workflow*
