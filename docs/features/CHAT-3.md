# CHAT-3: Always-on grounding policy + insufficient-evidence response

**Story**: Make the vault-only grounding policy **non-optional** at the message-assembly layer: every chat request built by the sidecar must prepend a built-in grounding system message, and when retrieval produces no usable context the workflow must emit a deterministic **insufficient-evidence** terminal stream (empty `sources`, structured marker) instead of letting the model answer from training data. Replace the conditional early return in [`buildMessagesWithContext`](../../src/sidecar/adapters/chatProviderMessages.ts) and extend `ChatWorkflow` / `ChatView` accordingly.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Planned

---

## 1. Summary

[REQUIREMENTS §1](../requirements/REQUIREMENTS.md) and [§6](../requirements/REQUIREMENTS.md) require vault-only chat, but the current pipeline only injects the `VAULT_CONTEXT_PREFIX` system message when retrieval returns non-empty context ([`buildMessagesWithContext`](../../src/sidecar/adapters/chatProviderMessages.ts)). When retrieval is empty — a common case for users whose notes _do_ contain the answer but retrieval missed (RET-4/RET-5/RET-6 address recall) — the model receives the conversation only and produces generic "I don't have your notes; paste them" replies.

[ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) makes grounding non-optional at the assembly layer and mandates an explicit insufficient-evidence path. This story delivers that slice for the built-in policy and the empty-retrieval response. User-configurable prompts are deferred to [CHAT-4](CHAT-4.md).

**Prerequisites:** [CHAT-1](CHAT-1.md), [CHAT-2](CHAT-2.md), [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) **Accepted**.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                      | Why it binds this story                                                                  |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-011-vault-only-chat-grounding.md](../decisions/ADR-011-vault-only-chat-grounding.md) | Mandates always-on built-in grounding policy and deterministic insufficient-evidence.    |
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md)           | Grounding assembled upstream of `IChatPort`; adapters remain provider-neutral.           |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md) | Defines the retrieval signal the workflow inspects when deciding insufficient-evidence.  |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: The built-in policy **copy** is owned by the implementer; reviewers should treat copy as adjustable until Phase A tests pin it behind a `groundingPolicyVersion` constant._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `buildMessagesWithContext` (or its successor) prepends the built-in grounding system message on **every** call, regardless of whether `context` is empty; the current `ctx === ''` early return is removed.
2. **Y2** — Provider message ordering matches [ADR-011 §2](../decisions/ADR-011-vault-only-chat-grounding.md#decision): built-in policy system → (reserved for user prompts in CHAT-4) → vault context system (when non-empty) → history → current user turn.
3. **Y3** — When `runChatStream` receives zero usable retrieval hits (workflow-defined threshold: zero `SearchResult`s), it **must not** call `IChatPort.complete`. It emits a product-owned insufficient-evidence `delta` string (or sequence) followed by a terminal event marking `sources: []` and `groundingOutcome: 'insufficient_evidence'`.
4. **Y4** — The built-in grounding policy text is declared as a **named constant** (e.g. `GROUNDING_POLICY_V1`) co-located with `chatProviderMessages.ts`, and the assembled system message includes the policy version identifier (logged; not shown to user).
5. **Y5** — `ChatView` renders the insufficient-evidence state **distinctly** from a normal assistant reply (at minimum: a dedicated CSS class and no "Sources:" footer when `sources.length === 0 && groundingOutcome === 'insufficient_evidence'`).
6. **Y6** — Core workflow remains portable: no new imports of `obsidian`, `better-sqlite3`, or `src/sidecar/**` from `src/core/workflows/ChatWorkflow.ts`.

---

## 5. API Endpoints + Schemas

No new sidecar routes. Extend the streaming payload shape.

Extend `ChatStreamChunk` (in [`src/core/domain/types.ts`](../../src/core/domain/types.ts)):

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
  systemPrompt?: string;              // reserved for CHAT-4
  vaultOrganizationPrompt?: string;   // reserved for CHAT-4
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

| Component / Hook | Props / Signature                             | State                              | Notes                                                 |
| ---------------- | --------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `ChatView`       | reads `ChatStreamChunk` from `streamChat(...)` | `messages`, `groundingOutcome`      | Persist `groundingOutcome` on the assistant message. |

### 6c. States (Loading / Error / Empty / Success)

| State                    | UI Behavior                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Answered (sources > 0)   | Normal assistant bubble + source pills.                                                              |
| Insufficient-evidence    | Assistant bubble with distinct style; no source pills; product-owned copy ("No matching notes…"). |
| Cancelled / Timeout      | Existing CHAT-2 behavior; unaffected.                                                                |

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                                      | Purpose                                                                              |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts`           | Unit tests: policy always prepended; ordering; empty-context behavior.               |
| 2   | `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts`          | Workflow emits insufficient-evidence terminal without calling `IChatPort.complete`. |

### Files to MODIFY

| #   | Path                                                     | Change                                                                                        |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `src/sidecar/adapters/chatProviderMessages.ts`           | Replace conditional injection with `buildGroundedMessages`; export `GROUNDING_POLICY_V1`.     |
| 2   | `src/core/workflows/ChatWorkflow.ts`                     | Detect empty retrieval → emit insufficient-evidence stream; thread `groundingOutcome`.         |
| 3   | `src/core/domain/types.ts`                               | Add `GroundingOutcome`, extend `ChatStreamDone`.                                              |
| 4   | `src/sidecar/runtime/SidecarRuntime.ts`                  | Pass `groundingOutcome` / `groundingPolicyVersion` on `done` event.                            |
| 5   | `src/plugin/ui/ChatView.ts`                              | Render insufficient-evidence state distinctly; hide sources when `sources.length === 0`.       |
| 6   | `tests/sidecar/runtime/*ChatStream*.test.ts`             | Cover terminal shape with new fields.                                                         |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — signature unchanged; grounding is assembled upstream (per [ADR-011 §5 non-decisions](../decisions/ADR-011-vault-only-chat-grounding.md#explicit-non-decisions)).
- `src/sidecar/adapters/Open{AI,Ollama}ChatAdapter.ts` — providers receive fully-assembled `messages`; no adapter changes.

---

## 8. Acceptance Criteria Checklist

### Phase A: Message assembly

- [ ] **A1** — `buildGroundedMessages` prepends the built-in policy system message when `retrievalContext === ''`.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A1_policy_always_present`
- [ ] **A2** — Ordering: first system message is `GROUNDING_POLICY_V1`, context system message (if any) sits after user-prompt slot and before conversation history.
  - Evidence: `tests/sidecar/adapters/chatProviderMessages.grounding.test.ts::A2_ordering`

### Phase B: Insufficient-evidence path

- [ ] **B1** — When `runChatStream` receives zero retrieval hits, `IChatPort.complete` is **not** invoked (fake port asserts 0 calls).
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B1_no_provider_call`
- [ ] **B2** — Terminal event carries `sources: []`, `groundingOutcome: 'insufficient_evidence'`, `groundingPolicyVersion: 'v1'`.
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B2_terminal_shape`
- [ ] **B3** — When retrieval returns ≥ 1 hit, existing answered flow still fires and terminal carries `groundingOutcome: 'answered'`.
  - Evidence: `tests/core/workflows/ChatWorkflow.insufficientEvidence.test.ts::B3_answered_path_unchanged`

### Phase C: UI rendering

- [ ] **C1** — `ChatView` renders a distinct state (CSS class + no sources footer) when the terminal carries `groundingOutcome: 'insufficient_evidence'`.
  - Evidence: `tests/plugin/ui/ChatView.insufficientEvidence.test.ts` (DOM assertion; no real Obsidian required)

### Phase Y: Binding & stack compliance

- [ ] **Y1** — `src/core/workflows/ChatWorkflow.ts` has no new imports from `obsidian`, `better-sqlite3`, or `src/sidecar/`.
  - Evidence: `npm run check:boundaries`
- [ ] **Y2** — `GROUNDING_POLICY_V1` constant lives in sidecar adapter module (not `src/core/`) so core stays text-free of product copy.
  - Evidence: `rg "GROUNDING_POLICY_V1" src/core` returns zero matches.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — **N/A**
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines; policy version logged on every chat request.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                            | Mitigation                                                                                                                     |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Insufficient-evidence fires when retrieval missed existing notes | RET-4/RET-5/RET-6 raise recall; copy must acknowledge "try narrower query / folder / tag" rather than assert vault emptiness. |
| 2   | Policy copy evolves, breaking pinned tests                 | Test against the **constant reference**, not literal text; evolve `GROUNDING_POLICY_VERSION` when wording changes materially.  |
| 3   | Some providers strip early system messages when over context window | Keep built-in policy short; CHAT-4 enforces a combined system-message token budget.                                           |

---

## Implementation Order

1. `src/core/domain/types.ts` — add `GroundingOutcome`, extend `ChatStreamDone`.
2. `src/sidecar/adapters/chatProviderMessages.ts` — add `GROUNDING_POLICY_V1`, `buildGroundedMessages`; deprecate conditional path.
3. `src/core/workflows/ChatWorkflow.ts` — detect empty retrieval, emit insufficient-evidence stream, thread grounding outcome.
4. `src/sidecar/runtime/SidecarRuntime.ts` — propagate new terminal fields.
5. `src/plugin/ui/ChatView.ts` — render distinct state.
6. Tests per Phase A/B/C; final verify (`build`, `lint`, `test`).

---

_Created: 2026-04-16 | Story: CHAT-3 | Epic: 5 — Retrieval, search workflow, and chat workflow_
