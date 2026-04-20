# RET-5: Hybrid retrieval (vector + FTS5 via RRF)

**Story**: Introduce a SQLite **FTS5 virtual table** over `nodes.content` (schema work in [STO-4](STO-4.md)); add `IDocumentStore.searchContentKeyword` that returns BM25-ranked hits; combine keyword and vector results in the coarse phase of `SearchWorkflow` / `ChatWorkflow` via **reciprocal rank fusion**; expose an `enableHybridSearch` setting toggle.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Planned

---

## 1. Summary

Vector-only retrieval dilutes exact-keyword signals: proper nouns, dates, tag-like tokens, and code identifiers often fail on cosine similarity because note prose adds noise. [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) adds an FTS5 index and fuses its BM25 ranks with vector ANN ranks via RRF. This story implements the coarse-phase fusion and the new store method; the migration/triggers live in [STO-4](STO-4.md).

**Prerequisites:** [RET-4](RET-4.md) (configurable coarse-K is the target for fusion output), [STO-4](STO-4.md) (FTS5 schema + triggers), [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) **Accepted**.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                             | Why it binds this story                                           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | Decides FTS5 + RRF + `enableHybridSearch` toggle.                 |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md)         | Phase 1 candidate set is the target of fusion.                    |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)                   | FTS5 lives in the sidecar DB; core consumes via `IDocumentStore`. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs do not contradict each other
- [ ] Section 4 (Binding constraints) is filled
- [ ] Phase Y has at least one criterion with non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `IDocumentStore.searchContentKeyword(query: string, k: number, filter?: NodeFilter): Promise<VectorMatch[]>` exists and is implemented on `SqliteDocumentStore` using `nodes_fts MATCH ? ORDER BY bm25(nodes_fts)`.
2. **Y2** — Coarse-phase fusion: when `enableHybridSearch === true`, the workflow runs `searchSummaryVectors(qv, coarseK)` and `searchContentKeyword(query, coarseK, { nodeTypes: ['note','topic','subtopic'] })` in parallel and merges their result rankings via reciprocal rank fusion with constant `k = 60`:
   \[
   \mathrm{fusedScore}(d) = \sum_r \frac{1}{60 + \mathrm{rank}_r(d)}
   \]
   Top `coarseK` by fused score drive Phase 2.
3. **Y3** — When `enableHybridSearch === false`, the BM25 call is skipped and Phase 1 runs vector-only (current behavior).
4. **Y4** — FTS5 MATCH query is built by a small helper that **sanitizes** the user query (strip FTS5 operator characters unless the user explicitly opts in with advanced syntax toggle — out of scope here; sanitize by default). Tests must cover queries with `"` and `*`.
5. **Y5** — Phase 2 remains vector-only (`searchContentVectors`); BM25 is not used for drill-down in MVP.
6. **Y6** — Pass-through for filters: `pathGlobs`, `dateRange`, and `tags` from [RET-3](RET-3.md) / [RET-6](RET-6.md) apply to both BM25 and vector queries; implementation must not double-filter or silently drop filters from one side.

---

## 5. API Endpoints + Schemas

Add to [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts):

```ts
export interface IDocumentStore {
  // ...existing
  searchContentKeyword(
    query: string,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]>;
}
```

Return shape reuses `VectorMatch` for ranking-merge convenience; `score` carries BM25 (lower = better — document in the store implementation; fuser consumes ranks, not raw scores, so sign doesn't matter at the workflow level).

Extend plugin settings (`enableHybridSearch: boolean; default true`). Thread through sidecar payloads like `coarseK` in [RET-4](RET-4.md).

---

## 6. Frontend Flow

Settings tab gains a toggle.

### 6a. Component / Data Hierarchy

```
SettingsTab
└── Retrieval section
    ├── Coarse candidate count (RET-4)
    └── Enable hybrid search `enableHybridSearch` (new)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature                     | State | Notes                                |
| ---------------- | ------------------------------------- | ----- | ------------------------------------ |
| `SettingsTab`    | read/write `settings.enableHybridSearch` | save | Boolean toggle; default on.         |

### 6c. States

| State     | UI Behavior                                                   |
| --------- | ------------------------------------------------------------- |
| Disabled  | Workflow reverts to pure vector retrieval; no schema change.  |

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                          | Purpose                                                                   |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `src/core/domain/rrf.ts`                                      | Pure reciprocal-rank-fusion helper with tests.                            |
| 2   | `tests/core/domain/rrf.test.ts`                               | Deterministic fusion over fixture rankings.                               |
| 3   | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts`      | BM25 round-trip against fixture vault; integration-level.                 |
| 4   | `tests/core/workflows/SearchWorkflow.hybrid.test.ts`          | Fusion driven by fake store with ranked BM25 + ranked vector inputs.      |

### Files to MODIFY

| #   | Path                                                  | Change                                                                                 |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `src/core/ports/IDocumentStore.ts`                    | Add `searchContentKeyword`.                                                            |
| 2   | `src/sidecar/adapters/SqliteDocumentStore.ts`         | Implement BM25 query; sanitize MATCH; honor filter.                                    |
| 3   | `src/core/workflows/SearchWorkflow.ts`                | Run hybrid when enabled; fuse via RRF helper.                                          |
| 4   | `src/core/workflows/ChatWorkflow.ts`                  | Inherit via shared retrieval helper.                                                   |
| 5   | `src/plugin/settings/SettingsTab.ts`                  | Add `enableHybridSearch` toggle.                                                       |
| 6   | `src/sidecar/runtime/SidecarRuntime.ts`               | Thread setting into retrieval options.                                                 |

### Files UNCHANGED

- `src/sidecar/db/migrations/002_fts.sql` — authored by [STO-4](STO-4.md).

---

## 8. Acceptance Criteria Checklist

### Phase A: Store-level BM25

- [ ] **A1** — `searchContentKeyword('Acme Corp', 10)` returns FTS5 BM25-ranked rows against a fixture vault containing notes mentioning "Acme Corp" in content.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A1_bm25_results`
- [ ] **A2** — MATCH query is sanitized: inputs containing `"`, `*`, or `()` do not throw and do not match operator syntax unintentionally.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A2_sanitize`

### Phase B: RRF fusion

- [ ] **B1** — Pure RRF helper produces deterministic fused ranking for two given rank lists; tie-breaking documented and tested.
  - Evidence: `tests/core/domain/rrf.test.ts::B1_fused_order`
- [ ] **B2** — `SearchWorkflow` with `enableHybridSearch: true` calls **both** `searchSummaryVectors` and `searchContentKeyword`; with `false`, only the vector call fires.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::B2_toggle`
- [ ] **B3** — Fixture ranked inputs produce expected top-K identities after RRF (e.g. a note that appears at rank 1 on BM25 and rank 10 on vector fuses above a note at ranks 3 and 15).
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::B3_fusion_behavior`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — `rrf.ts` lives in `src/core/domain/` with no forbidden imports.
  - Evidence: `npm run check:boundaries`
- [ ] **Y2** — **(non-mock)** SQLite BM25 result order for a three-note fixture matches expectations (integration test with real `better-sqlite3`).
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::Y2_integration`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors
- [ ] **Z2** — `npm run lint` passes
- [ ] **Z3** — No `any` types
- [ ] **Z4** — N/A
- [ ] **Z5** — Log per-request: both candidate counts, fused top-K count, toggle state.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                          | Mitigation                                                                                                  |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | FTS5 tokenizer misses CJK or domain-specific terms       | unicode61 with diacritic folding is MVP default; advanced tokenizers tracked as later story.                |
| 2   | Keyword hits drown out semantic hits in RRF              | RRF uses rank, not scores; `k = 60` constant well-behaved; revisit weighting only if telemetry disagrees.   |
| 3   | Filter pass-through bug (filter applied to one side only) | Shared `NodeFilter` object in helper; test explicitly asserts both sides saw the filter.                    |

---

## Implementation Order

1. RRF helper + tests.
2. `searchContentKeyword` on port + SQLite store + sanitizer.
3. Workflow fusion + toggle threading.
4. Settings UI; sidecar runtime wiring.
5. Full verify.

---

_Created: 2026-04-16 | Story: RET-5 | Epic: 5 — Retrieval, search workflow, and chat workflow_
