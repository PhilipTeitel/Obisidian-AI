# RET-4: Configurable coarse-K + content-only fallback

**Story**: Replace the hard-coded `kSummary = Math.min(k, 8)` in [`SearchWorkflow.mapSearchK`](../../src/core/workflows/SearchWorkflow.ts) with a user-configurable `coarseK` setting threaded through plugin settings → sidecar → workflow; add a **content-only fallback** ANN when the coarse phase returns fewer usable hits than a configurable floor; apply the same retrieval options to `ChatWorkflow` so chat and search do not diverge.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Planned

---

## 1. Summary

[ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) identifies the hard cap at 8 as the dominant cause of false negatives in vaults with more than a handful of notes: Phase 2 can only search descendants of the top 8 summary hits, so any relevant content outside those 8 regions is unreachable. Separately, when summaries fail to match at all, [RET-1 Y4](RET-1.md) returns empty results — which is now especially visible because [CHAT-3](CHAT-3.md) converts empty retrieval into a deterministic insufficient-evidence reply.

This story removes the cap, parameterizes coarse-K, and adds the graceful fallback path. It does **not** introduce FTS5 (that is [RET-5](RET-5.md)) or filters (that is [RET-6](RET-6.md)) — those stories layer on top.

**Prerequisites:** [RET-1](RET-1.md), [RET-2](RET-2.md), [CHAT-1](CHAT-1.md); [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) **Accepted**.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                             | Why it binds this story                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | Source of truth for configurable `coarseK`, fallback threshold, and chat/search parity.                  |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md)         | Phased retrieval contract; fallback amendment.                                                           |
| [docs/decisions/ADR-011-vault-only-chat-grounding.md](../decisions/ADR-011-vault-only-chat-grounding.md)         | Downstream: fallback success moves insufficient-evidence threshold from "summary empty" to "truly empty". |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `mapSearchK` no longer applies `Math.min(k, 8)`. `kSummary` is driven by an explicit `coarseK` parameter on the search options, with a default constant (e.g. `DEFAULT_COARSE_K = 32`) used only when the caller does not provide one.
2. **Y2** — `SearchRequest` (and the chat options passed to `runChatStream`) accept optional `coarseK?: number`. Sidecar route handlers map `settings.chatCoarseK` onto the workflow option for `chat`; search route similarly. Defaults documented in README.
3. **Y3** — Content-only fallback fires when `coarseHits.length < fallbackFloor` where `fallbackFloor = max(4, Math.floor(coarseK / 4))`. The fallback runs `searchContentVectors(queryVector, coarseK, /* no subtreeRootNodeIds */)` and merges its results with Phase 2 descendants from the original coarse hits (dedup by `nodeId`).
4. **Y4** — `ChatWorkflow` + sidecar runtime route retrieval through the same shared helper used by `SearchWorkflow`; the previously-hardcoded `DEFAULT_SEARCH_ASSEMBLY` in [`SidecarRuntime.handleChatStream`](../../src/sidecar/runtime/SidecarRuntime.ts) is replaced with options derived from settings.
5. **Y5** — Empty-retrieval behavior: if **even after fallback** the result set is empty, the existing empty-results path ([CHAT-3 B1](CHAT-3.md)) fires and the insufficient-evidence response is emitted. No regression relative to current behavior.
6. **Y6** — No forbidden imports introduced in `src/core/workflows/`.

---

## 5. API Endpoints + Schemas

Extend types (in [`src/core/domain/types.ts`](../../src/core/domain/types.ts)):

```ts
export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
  tags?: string[];
  coarseK?: number; // new; default DEFAULT_COARSE_K when omitted
}

export interface ChatWorkflowOptions {
  search: SearchAssemblyOptions;
  apiKey?: string;
  coarseK?: number; // new
}
```

Extend plugin settings (`chatCoarseK: number; default 32`). Mirror into sidecar settings payload and into the message-protocol `chat` / `search` payload as optional overrides.

No new port methods (fallback uses existing `searchContentVectors` with `filter.subtreeRootNodeIds` omitted).

---

## 6. Frontend Flow

Settings tab gains one field; search and chat panes do not change visually.

### 6a. Component / Data Hierarchy

```
SettingsTab
└── Retrieval section (new or existing)
    ├── Search result count (existing)
    └── Coarse candidate count `chatCoarseK` (new)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature               | State  | Notes                                             |
| ---------------- | ------------------------------- | ------ | ------------------------------------------------- |
| `SettingsTab`    | read/write `settings.chatCoarseK` | debounce save | Integer input; min 1, max 256; default 32.      |

### 6c. States (Loading / Error / Empty / Success)

| State            | UI Behavior                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Out of range     | Clamp and warn inline; do not reject silently.                    |

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                                 | Purpose                                                                 |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `tests/core/workflows/SearchWorkflow.coarseK.test.ts`                | Cap removed; default honored; override honored; fallback triggers.      |
| 2   | `tests/core/workflows/ChatWorkflow.coarseK.test.ts`                  | Chat uses same retrieval path with user options.                        |

### Files to MODIFY

| #   | Path                                                  | Change                                                                               |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `src/core/workflows/SearchWorkflow.ts`                | Remove `Math.min(k, 8)`; add `coarseK` option; implement fallback path.              |
| 2   | `src/core/workflows/ChatWorkflow.ts`                  | Accept and forward `coarseK`; share retrieval helper per [RET-1 Y5](RET-1.md).        |
| 3   | `src/core/domain/types.ts`                            | Extend `SearchRequest` + `ChatWorkflowOptions`.                                      |
| 4   | `src/plugin/settings/SettingsTab.ts`                  | Add `chatCoarseK` field + persistence.                                               |
| 5   | `src/sidecar/runtime/SidecarRuntime.ts`               | Replace `DEFAULT_SEARCH_ASSEMBLY` hardcode; thread settings through chat/search.     |
| 6   | `src/sidecar/http/httpServer.ts`, `stdio/stdioServer.ts` | Pass `coarseK` from payload to handlers.                                          |
| 7   | `tests/core/workflows/SearchWorkflow.test.ts`          | Update any test that asserts `min(k, 8)` behavior.                                  |

### Files UNCHANGED

- `src/sidecar/adapters/SqliteDocumentStore.ts` — `searchContentVectors` already accepts an optional filter; omitting `subtreeRootNodeIds` is the fallback path.

---

## 8. Acceptance Criteria Checklist

### Phase A: Coarse-K configurability

- [ ] **A1** — With a fake store returning 40 summary hits and `coarseK = 25`, Phase 2 is invoked with descendants of exactly 25 candidate subtrees.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A1_respects_coarseK`
- [ ] **A2** — Default `coarseK` is `DEFAULT_COARSE_K` (32) when neither caller nor settings override it.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A2_default`

### Phase B: Fallback

- [ ] **B1** — When coarse returns `< fallbackFloor` hits, unrestricted `searchContentVectors` is invoked (filter lacks `subtreeRootNodeIds`).
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B1_fallback_fires`
- [ ] **B2** — Fallback results are merged with Phase 2 descendants; no `nodeId` appears twice.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B2_merge_dedup`
- [ ] **B3** — When coarse returns zero hits, fallback runs unconditionally; if fallback is also empty, workflow returns `results: []`.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B3_empty_after_fallback`

### Phase C: Chat/search parity

- [ ] **C1** — `ChatWorkflow` invoked from the sidecar runtime uses retrieval options derived from settings (not `DEFAULT_SEARCH_ASSEMBLY`).
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::C1_settings_propagate`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — Core imports unchanged.
  - Evidence: `npm run check:boundaries`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — **N/A**
- [ ] **Z5** — Logging: coarse-K, fallback-fired flag, and final result count logged at `debug` for each chat/search request.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                                | Mitigation                                                                                                                |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Larger `coarseK` raises Phase 2 work proportional to subtree fanout | Bound `kContent` separately; default `coarseK = 32` is safe in measured vaults; revisit after telemetry.                   |
| 2   | Fallback masks genuinely empty vaults                          | Fallback returns empty when content ANN returns empty; CHAT-3 insufficient-evidence path still fires.                     |
| 3   | Existing tests asserting `min(k, 8)` break                     | Update assertions in RET-1 tests explicitly; [RET-1 §5](RET-1.md) already flagged this as implementer-defined.             |

---

## Implementation Order

1. Extend types + settings.
2. Remove cap in `mapSearchK`; add `coarseK` threading.
3. Implement fallback merge; update `SearchWorkflow` + `ChatWorkflow`.
4. Wire settings through `SidecarRuntime` and transport handlers.
5. Update tests; final verify.

---

_Created: 2026-04-16 | Story: RET-4 | Epic: 5 — Retrieval, search workflow, and chat workflow_
