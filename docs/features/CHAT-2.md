# CHAT-2: Chat cancel / timeout behavior end-to-end

**Story**: Implement **configurable timeout** and **client-initiated cancellation** for streaming chat per [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md): extend **`IChatPort.complete`**, **`ISidecarTransport.streamChat`**, and concrete chat adapters (or stubs if PRV-2 not landed) so **`chatTimeout`** from settings maps to **`timeoutMs`** and **`AbortSignal`** stops streams without hanging.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Small
**Status**: Open

---

## 1. Summary

[REQUIREMENTS §6](../requirements/REQUIREMENTS.md) and [README Plugin Settings](../../README.md#plugin-settings) require **`chatTimeout`** (default **30_000** ms). [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md) binds how **`AbortSignal`** and **`timeoutMs`** cross **`IChatPort`** and the **transport**. This story completes the **vertical slice** for MVP behavior: when the user cancels or the timeout elapses, **no further deltas** arrive and sidecar/provider resources are **best-effort** released.

**Prerequisites:** [CHAT-1](CHAT-1.md) (or minimal chat route calling `IChatPort`), [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md) **Accepted**. If **PRV-2** (OpenAI/Ollama chat adapters) is not yet implemented, ship **fake/sidecar-local** adapters in tests plus **interface + compile-time** wiring so PRV-2 drops in without signature churn.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-009-chat-cancellation-and-timeout.md](../decisions/ADR-009-chat-cancellation-and-timeout.md) | Source of truth for `signal`, `timeoutMs`, and transport propagation. |
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md) | Chat remains behind **`IChatPort`**; adapters honor abort. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Transport and sidecar lifecycle boundaries. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: No **Tensions / conflicts** identified._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — **`IChatPort.complete(messages, context, apiKey?, options?)`** where `options?: { signal?: AbortSignal; timeoutMs?: number }` per ADR-009; existing three-arg call sites remain valid (`options` optional).
2. **Y2** — **`ISidecarTransport.streamChat(payload, options?)`** with `options?: { signal?: AbortSignal }` per ADR-009.
3. **Y3** — Default **`timeoutMs`** for sidecar-invoked chat equals plugin setting **`chatTimeout`** when wired; core unit tests may pass explicit numbers.
4. **Y4** — When **`signal`** aborts mid-stream, the async iterable from **`complete`** **terminates** within **1 second** in tests using a deliberately slow fake (no infinite loop).
5. **Y5** — README [API Contract](../../README.md#api-contract) **Port** and **Sidecar Message** rows for **`IChatPort`** / **`chat`** updated to mention **`options`** / cancellation behavior at a summary level (link ADR-009).

---

## 5. API Endpoints + Schemas

```ts
// IChatPort (conceptual — implement in src/core/ports/IChatPort.ts)
export interface ChatCompletionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface IChatPort {
  complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string>;
}
```

```ts
// ISidecarTransport
streamChat(
  request: Extract<SidecarRequest, { type: 'chat' }>['payload'],
  options?: { signal?: AbortSignal },
): AsyncIterable<ChatStreamChunk>;
```

`SidecarRequest` chat payload type in `types.ts` may add **`timeoutMs?: number`** if timeout is better signaled per request than ctor-injected settings — **choose one approach** in implementation and document in README (single source: either payload or transport client config).

---

## 6. Frontend Flow

Not applicable in core repo slice; **UI-3** passes `AbortSignal` when implemented. This story’s **transport** tests simulate the plugin caller.

### 6a. Component / Data Hierarchy

```
(n/a)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| — | — | — | — |

### 6c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| — | — |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| — | — | None required; place slow-stream fakes next to `*.test.ts` if needed. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/ports/IChatPort.ts` | Add `ChatCompletionOptions`; extend `complete` signature. |
| 2 | `src/core/ports/ISidecarTransport.ts` | Second arg on `streamChat`. |
| 3 | `src/core/workflows/ChatWorkflow.ts` | Thread `options` from caller / sidecar route into `IChatPort.complete`. |
| 4 | `src/core/workflows/ChatWorkflow.test.ts` | Abort + timeout cases. |
| 5 | `src/sidecar/adapters/*ChatAdapter*.ts` | Honor `signal` / `timeoutMs` when PRV-2 files exist; else document stub. |
| 6 | `README.md` | API Contract table + Architecture decisions list: ADR-009 link (**Y5**). |

### Files UNCHANGED (confirm no modifications needed)

- `docs/decisions/ADR-009-chat-cancellation-and-timeout.md` — already accepted; reference only unless decision text must be amended (avoid unless bug).

---

## 8. Acceptance Criteria Checklist

### Phase A: Port signatures

- [ ] **A1** — **(binding)** `npm run typecheck` passes after updating **`IChatPort.complete`** and every implementation / test fake in the repo to the four-parameter signature.
  - Evidence: `package.json` script `typecheck` (no TS errors)

### Phase B: Timeout

- [ ] **B1** — Fake chat port that never yields respects **`timeoutMs: 50`** and **stops** within a bounded window (use fake timers or real clock with generous upper bound in CI).
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::B1_timeout_stops_stream(vitest)` or adapter test file if logic lives only in adapter

### Phase C: Cancel

- [ ] **C1** — When **`AbortSignal.abort()`** is called after the first delta, **no further deltas** are observed from `complete(...)`.
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::C1_abort_stops_deltas(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** After port signature changes, **`npm run verify:core-imports`** still passes (core must not import `obsidian`, `better-sqlite3`, or `../sidecar/`).
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — **N/A**
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Ollama stream cancel weaker than OpenAI | Document best-effort; close reader/socket in adapter. |
| 2 | Stdio cancel framing undefined until SRV-1 | ADR-009 explicit non-decision; plugin-side abort still stops client read. |

---

## Implementation Order

1. Update **`IChatPort`** + fix all compile errors in repo (grep `IChatPort`).
2. Update **`ChatWorkflow`** to accept and forward `ChatCompletionOptions`.
3. Implement adapter / fake behavior + **B1**, **C1** tests.
4. Update **`ISidecarTransport`** + any plugin stub implementing it (if present).
5. README API Contract + ADR traceability list (**Y5**).
6. **Final verify** — build, lint, tests.

---

*Created: 2026-04-05 | Story: CHAT-2 | Epic: 5 — Retrieval, search workflow, and chat workflow*
