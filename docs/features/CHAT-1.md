# CHAT-1: `ChatWorkflow` — retrieve → assemble context → stream completion → sources

**Story**: Implement **`ChatWorkflow`** in `src/core/workflows/ChatWorkflow.ts` that (1) derives a **retrieval query** from the latest user turn in the conversation, (2) reuses the **same phased retrieval and assembly** behavior as search ([RET-1](RET-1.md), [RET-2](RET-2.md)) to build a **vault-only** context string, (3) streams assistant text via **`IChatPort.complete`**, and (4) emits **`Source[]`** aligned with the notes/nodes that contributed to context (for `ChatStreamChunk` `done`).
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Large
**Status**: Complete

---

## 1. Summary

[REQUIREMENTS §6](../requirements/REQUIREMENTS.md) requires chat to use **retrieval from the hierarchical index** for **vault-only** context plus **conversation history**. The sidecar already types a streaming chat contract ([`ChatStreamChunk`](../../src/core/domain/types.ts), [`ISidecarTransport.streamChat`](../../src/core/ports/ISidecarTransport.ts)); this story implements the **core orchestration** that **fills `context`** before invoking the chat port.

**Retrieval query rule (MVP):** Use the **`content`** of the **last** `ChatMessage` with `role === 'user'` in the `messages` array. If none exists, treat as **validation error** (empty iterable or thrown error — pick one and test).

**Prerequisites:** [RET-1](RET-1.md) and [RET-2](RET-2.md) (or RET-1 with RET-2’s assembly module inlined). **Out of scope:** agent file operations ([REQUIREMENTS §6](../requirements/REQUIREMENTS.md) agent bullet) — separate backlog; **CHAT-1** does not write vault files.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md) | RAG context must follow phased retrieval, not ad-hoc grep. |
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md) | Chat only via **`IChatPort`**; embeddings via **`IEmbeddingPort`**. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Core stays free of Obsidian and vault FS; `ChatWorkflow` is sidecar-callable. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: No **Tensions / conflicts** identified. README API table omits `context` on the wire because the sidecar computes it — consistent with optional `context?` in types._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `ChatWorkflow` must **not** call external HTTP directly; only **`IChatPort`** and ports already used by `SearchWorkflow`.
2. **Y2** — **No non-vault knowledge** is concatenated into the retrieval/assembled context string (no static web snippets, no hard-coded general knowledge blocks).
3. **Y3** — **`messages`** passed to **`IChatPort.complete`** are the **same** conversation array supplied by the caller (do not drop prior turns); **system** prompt injection for “use only context” may be prefixed in workflow **only** if covered by tests and logged at debug.
4. **Y4** — **`Source[]`** must contain **at least one** entry per **distinct `notePath`** included in the assembled context block for the top retrieval hits (exact cardinality rule: **one `Source` per `SearchResult` used**, deduped by `nodeId` when same node — document in tests).
5. **Y5** — Reuse **`runSearch`** internals via **shared private module** or **extracted `retrieveCandidates()`** to avoid drifting search vs chat retrieval (single implementation path for phased ANN).

---

## 5. API Endpoints + Schemas

Wire-level `chat` payload remains **`{ messages, apiKey? }`** per [README API Contract](../../README.md#sidecar-message-protocol); assembled context is **not** required from the plugin.

Optional **internal** options type:

```ts
export interface ChatWorkflowOptions {
  search: SearchAssemblyOptions; // from RET-2
  /** Forwarded to search / embed calls */
  apiKey?: string;
}
```

```ts
export interface ChatWorkflowStreamChunk {
  delta: string;
}

export interface ChatWorkflowResult {
  sources: Source[];
}

/** Yields string deltas then resolves sources — or mirror IChatPort pattern */
export async function* runChatStream(
  deps: ChatWorkflowDeps,
  messages: ChatMessage[],
  options: ChatWorkflowOptions,
): AsyncGenerator<string, ChatWorkflowResult>;
```

`ChatWorkflowDeps` = `SearchWorkflowDeps` + `{ chat: IChatPort }` (or equivalent naming).

---

## 6. Frontend Flow

Not applicable (UI-3 consumes transport stream later).

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
| 1 | `src/core/workflows/ChatWorkflow.ts` | Orchestration: derive query → search/assembly → `IChatPort.complete` → map sources. |
| 2 | `src/core/workflows/ChatWorkflow.test.ts` | Fakes for chat + store + embedder; history forwarded; sources length. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/SearchWorkflow.ts` (or new `retrievalShared.ts`) | Export or share retrieval helper per **Y5** (avoid duplication). |
| 2 | `src/core/index.ts` | Export if part of public core API. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/ISidecarTransport.ts` — CHAT-2 extends `streamChat`; not required for core workflow unit tests.

---

## 8. Acceptance Criteria Checklist

### Phase A: Retrieval integration

- [x] **A1** — For `messages` ending with `{ role: 'user', content: 'Q' }`, the workflow invokes the shared retrieval path with query **`'Q'`** (trimmed).
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::A1_uses_last_user_message(vitest)`

- [x] **A2** — When no `user` message exists, workflow **fails fast** with documented behavior (error or zero deltas).
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::A2_no_user_message_fails(vitest)`

### Phase B: Chat port contract

- [x] **B1** — `IChatPort.complete` receives **`messages`** identical to input and a **non-empty** `context` string when retrieval returns hits in the fake store.
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::B1_context_passed_to_chat(vitest)`

- [x] **B2** — Every yielded chunk from the fake chat port is forwarded to the consumer in order until completion.
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::B2_streams_deltas(vitest)`

### Phase C: Sources

- [x] **C1** — Terminal result includes **`sources`** with `notePath` matching `SearchResult.notePath` for retrieved hits used in context.
  - Evidence: `src/core/workflows/ChatWorkflow.test.ts::C1_sources_aligned(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `ChatWorkflow.ts` imports no `obsidian`, `better-sqlite3`, or `src/sidecar/` paths.
  - Evidence: `npm run check:boundaries` or `rg` pattern as in RET-1 **Y1**

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias — **N/A**
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Long history + large context exceeds model window | RET-2 budgets + future PRV tuning; document `totalTokenBudget` source. |
| 2 | Duplicated retrieval vs search | Enforce **Y5** in code review; add grep test for single `searchSummaryVectors` call site in shared helper. |

---

## Implementation Order

1. Extract shared retrieval helper from `SearchWorkflow` (**Y5**).
2. Implement `ChatWorkflow.ts` + tests **A1–C1**.
3. **Verify** boundaries + `vitest`.
4. **Final verify** — `npm run build` + full tests.

---

*Created: 2026-04-05 | Story: CHAT-1 | Epic: 5 — Retrieval, search workflow, and chat workflow*
