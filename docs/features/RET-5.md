# RET-5: Hybrid retrieval (vector + FTS5 via RRF)

**Story**: Introduce an `IDocumentStore.searchContentKeyword` method backed by SQLite FTS5 (`nodes_fts`), fuse its BM25 ranking with the existing summary-vector ANN ranking via reciprocal rank fusion in the coarse phase of `SearchWorkflow` / `ChatWorkflow`, and gate the behavior behind a new `enableHybridSearch` user setting.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Vector-only coarse retrieval dilutes exact-keyword signals: proper nouns ("Acme Corp"), literal dates ("2026-02-14"), tag-like tokens (`#jobsearch`), and code identifiers routinely fall outside the coarse-phase cutoff when cosine similarity is swamped by the surrounding prose. [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) binds the fix: stand up an FTS5 virtual table over indexed node content, issue a BM25 query alongside the existing summary-vector ANN, and merge the two ranked lists with reciprocal rank fusion (RRF, fixed `k = 60`) before the top `coarseK` items drive Phase 2. This story wires that fusion into both `SearchWorkflow` and `ChatWorkflow`, adds the `searchContentKeyword` method to `IDocumentStore` and its SQLite adapter, and exposes the `enableHybridSearch` toggle (default on) in plugin settings.

The story is tightly scoped to **coarse-phase hybrid fusion and its toggle**. The FTS5 schema, triggers, and migration bookkeeping are authored by the adjacent enabler story [STO-4](STO-4.md). Configurable `coarseK` and the content-only fallback live in [RET-4](RET-4.md); this story consumes `coarseK` as an input and preserves the fallback path — in particular, `pathGlobs`/`dateRange` filters (from [RET-6](RET-6.md)) must still be applied on the fallback ANN, because "unrestricted" in the fallback means "no subtree-root filter," not "no user filter." The design principle guiding the implementation is **rank-based fusion only**: BM25 raw scores and cosine scores are incomparable, so the fuser never sees either — only ranks — which removes the need for tunable weights in MVP.

Requirements trace to [REQ-004](../requirements/REQ-004-hybrid-and-filters.md) (hybrid retrieval and temporal/path filters). REQ-004 is shared across RET-5, RET-6, and STO-4; this story covers only the scenarios whose `Implemented by:` tag includes **RET-5**.

**In-scope `Sn` (REQ-004 tags include RET-5):** S1, S2, S3, S4, S12, S13, S14, S15.

**Out-of-scope `Sn` (covered by sibling stories):**

- **S5** — single `pathGlob` scopes the query → **RET-6** owns the `pathGlobs` push-down on `SearchRequest`.
- **S6** — multiple globs are unioned → **RET-6** owns the glob matcher semantics.
- **S7** — `dateRange` restricts by parsed `note_date` → **RET-6** owns the date-range push-down; **STO-4** owns the `note_meta.note_date` column.
- **S8** — NULL `note_date` excluded under `dateRange` → **RET-6** owns the predicate; **STO-4** owns the column/index.
- **S9** — `dailyNotePathGlobs` + `dailyNoteDatePattern` populate `note_date` at index time → **RET-6** owns parsing; **STO-4** owns the schema and migration.
- **S10** — `pathGlobs ∩ dateRange` intersection semantics → **RET-6** owns the combined predicate.
- **S11** — chat-input slash-command filter parsing → **RET-6** owns the chat-input preprocessor (plugin UI concern).

RET-5 does not introduce any `pathGlobs`, `dateRange`, or daily-note behavior of its own; where those filters arrive as inputs from RET-6, RET-5 simply **passes them through** unchanged to both the BM25 and vector legs of coarse retrieval (and to the content-only fallback), which is the boundary covered by S14 here.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | **Binding.** Fixes FTS5 as the keyword backend, RRF with `k = 60` as the fusion algorithm, `enableHybridSearch` as the toggle (default true), the restriction of the coarse-phase BM25 leg to `type IN ('note','topic','subtopic')`, and the "no chat-vs-search divergence" rule. |
| [`docs/decisions/ADR-003-phased-retrieval-strategy.md`](../decisions/ADR-003-phased-retrieval-strategy.md) | The coarse (Phase 1) candidate set is the target of fusion; Phase 2 drill-down remains vector-only per ADR-012's explicit non-decision. |
| [`docs/decisions/ADR-006-sidecar-architecture.md`](../decisions/ADR-006-sidecar-architecture.md) | FTS5 lives in the per-vault SQLite sidecar DB; core consumes BM25 strictly through the `IDocumentStore` port. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Non-binding for RET-5 behavior but consulted for S14: the content-only fallback must still respect `pathGlobs` / `dateRange` supplied by callers. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (ADR-012, ADR-003, ADR-006, ADR-014 are all Accepted)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries (FTS5 in per-vault SQLite DB; RRF fixed `k = 60`; toggle default on)
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Section 4b (Ports & Adapters) lists every port/adapter this story creates or modifies
- [ ] Section 8a (Test Plan) is filled and every AC ID (including Phase Y and Phase Z) is referenced by at least one planned test row
- [ ] For the `IDocumentStore` port and `SqliteDocumentStore` adapter, Section 8a contains both a **contract test against the port** and an **integration test against the real backing service** (no mock of SQLite/FTS5), and Phase Y has a `(binding)` criterion citing that integration test file
- [ ] Every in-scope Gherkin `Sn` (S1, S2, S3, S4, S12, S13, S14, S15) from [REQ-004](../requirements/REQ-004-hybrid-and-filters.md) is mapped to at least one acceptance test row in Section 8a; out-of-scope `Sn` (S5, S6, S7, S8, S9, S10, S11) are declared in §1 with their owning story
- [ ] Phase Y includes at least one criterion with **non-mock** evidence — specifically an integration test that exercises the real `better-sqlite3` FTS5 path end-to-end

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `IDocumentStore.searchContentKeyword(query: string, k: number, filter?: NodeFilter): Promise<VectorMatch[]>` exists on the port; the SQLite adapter implements it using `nodes_fts MATCH ? ORDER BY bm25(nodes_fts)` and returns rows whose `score` field carries BM25 (lower is better). Implementation must not reach out to any keyword backend other than FTS5 on the per-vault SQLite database.
2. **Y2** — When `enableHybridSearch === true`, the coarse phase of `SearchWorkflow` / `ChatWorkflow` runs `searchSummaryVectors(qv, coarseK)` and `searchContentKeyword(query, coarseK, { nodeTypes: ['note','topic','subtopic'], ...userFilters })` in parallel and merges their rankings via reciprocal rank fusion with constant `k = 60`. The top `coarseK` items by fused score drive Phase 2.
3. **Y3** — When `enableHybridSearch === false`, the BM25 call is **not issued** and the RRF merge does not run; Phase 1 is vector-only (baseline parity with pre-hybrid behavior). A code path that issues FTS5 in any shape when the toggle is false is a regression.
4. **Y4** — The coarse-phase BM25 leg is restricted to summary-bearing node types (`note`, `topic`, `subtopic`) — bullet and paragraph leaves are never returned by the coarse BM25 query. Phase 2 drill-down remains vector-only in MVP.
5. **Y5** — User-supplied filters (`pathGlobs`, `dateRange`, `tags`) are passed through unchanged to **both** the vector leg and the BM25 leg of coarse retrieval, and to the content-only fallback ANN. The fusion helper does not filter; the store does. Dropping, duplicating, or applying a filter to only one leg is forbidden.
6. **Y6** — The FTS5 MATCH argument is produced by a small sanitizer that neutralizes FTS5 operator characters (`"`, `*`, `(`, `)`, `:`, `-`, `^`) in the user's raw query. Advanced FTS5 syntax is **not** exposed to the user in MVP.
7. **Y7** — When the coarse phase (hybrid or vector-only) plus the content-only fallback return zero candidates after all user filters, `SearchWorkflow` emits an empty candidate set and the caller routes into the existing insufficient-evidence reply from [REQ-001](../requirements/REQ-001-grounding-policy.md) / ADR-011. RET-5 does not add a new empty-state UI.
8. **Y8** — `SearchWorkflow` and `ChatWorkflow` route through the same shared retrieval helper; the `enableHybridSearch` toggle and the RRF merge are not duplicated across the two workflows (ADR-012 Decision 6, "no chat-vs-search divergence").

---

## 4b. Ports & Adapters

This story extends the existing hexagonal persistence boundary. One port gains a new method; one adapter implements it against the real backing service.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IDocumentStore` | `src/core/ports/IDocumentStore.ts` | `SqliteDocumentStore` (`src/sidecar/adapters/SqliteDocumentStore.ts`) | Local per-vault SQLite database at `var/test/ret5-hybrid.db` with migrations up through `002_fts.sql` applied (FTS5 virtual table `nodes_fts` created by [STO-4](STO-4.md)) | `searchContentKeyword` is the new port method added by this story; the adapter uses `better-sqlite3` + the FTS5 virtual table already built for it by STO-4. |

Section 8a contains a `contract` test row for the `IDocumentStore` port and an `integration` test row for `SqliteDocumentStore` against the real SQLite+FTS5 service; Phase Y Y3 cites the integration test file.

---

## 5. API Endpoints + Schemas

No HTTP/IPC endpoints are added or changed by RET-5. The sidecar's existing chat/search payloads already carry `coarseK` (RET-4) and will be extended to carry `enableHybridSearch`; the freeform query text is unchanged.

**Port additions** in [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts):

```ts
export interface IDocumentStore {
  searchContentKeyword(
    query: string,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]>;
}
```

`VectorMatch` is reused; `score` carries BM25 (lower = better, documented on the adapter implementation). The fuser operates on rank positions only, so the sign of `score` is irrelevant at the workflow level.

**Domain-type additions** in [`src/core/domain/types.ts`](../../src/core/domain/types.ts):

```ts
export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
  tags?: string[];
  coarseK?: number;
  enableHybridSearch?: boolean;
}

export interface ChatWorkflowOptions {
  search: SearchAssemblyOptions;
  apiKey?: string;
  coarseK?: number;
  enableHybridSearch?: boolean;
}
```

**Settings additions** in `src/plugin/settings/defaults.ts` + `SettingsTab.ts`:

```ts
export interface PluginSettings {
  enableHybridSearch: boolean;
}

export const DEFAULT_ENABLE_HYBRID_SEARCH = true;
```

The sidecar runtime threads `enableHybridSearch` from settings into every chat/search retrieval call alongside `coarseK`.

---

## 6. Frontend Flow

The only UI surface is a single toggle in the plugin's settings tab. No changes to the chat pane or semantic-search pane visuals.

### 6a. Component / Data Hierarchy

```
SettingsTab
└── Retrieval section
    ├── Coarse candidate count (chatCoarseK — from RET-4)
    └── Enable hybrid search (enableHybridSearch — NEW)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SettingsTab` | reads/writes `settings.enableHybridSearch: boolean` | persists via existing settings save pipeline | Boolean toggle; default `true`; label: "Enable hybrid keyword + vector retrieval"; helptext references the FTS5 backend and notes that a reindex is required if FTS5 has never been populated (linked to STO-4 migration guidance). |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | N/A — settings toggle has no async load state. |
| Error | Settings save failures are surfaced by the existing SettingsTab error path; no RET-5-specific error UI. |
| Empty | N/A for the toggle itself. When hybrid coarse retrieval returns zero candidates after filters, Y7 routes the response into the existing insufficient-evidence reply owned by REQ-001; no new UI state is introduced here. |
| Success | Toggle persists; subsequent chat/search requests honor the new value with no restart required (setting is re-read per request by the sidecar runtime, as with `chatCoarseK`). |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/rrf.ts` | Pure reciprocal-rank-fusion helper (`fuseRankings(lists: Array<Array<{id: string}>>, k?: number): Array<{id: string; score: number}>`); no I/O, no time-based inputs. |
| 2 | `src/core/domain/fts-sanitize.ts` | Pure sanitizer that neutralizes FTS5 operator characters for a user-supplied query string (used only by `SqliteDocumentStore.searchContentKeyword`, but lives in core so the workflow-level contract test can reuse the behavior). |
| 3 | `tests/core/domain/rrf.test.ts` | Unit tests for the RRF helper: fused order, tie-break rule, fixed constant `k = 60`. |
| 4 | `tests/core/domain/fts-sanitize.test.ts` | Unit tests for sanitizer: `"`, `*`, `()`, `:`, `-`, `^` do not produce runtime errors or unintended operator matches. |
| 5 | `tests/core/workflows/SearchWorkflow.hybrid.test.ts` | Fake-store unit tests for hybrid toggle, fusion merge, summary-type restriction on coarse BM25, filter pass-through to both legs, fallback-preserves-filters, empty-after-filters → grounding handoff. |
| 6 | `tests/core/workflows/ChatWorkflow.hybrid.test.ts` | Parity test: `ChatWorkflow` uses the same retrieval helper as `SearchWorkflow` and honors `enableHybridSearch`. |
| 7 | `tests/contract/document-store.contract.ts` | Contract suite for `IDocumentStore` focused on `searchContentKeyword` semantics (BM25-ranked, filter-honored, `nodeTypes` push-down). Any adapter must pass. |
| 8 | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts` | Integration test against real `better-sqlite3` + FTS5: BM25 ordering, sanitizer safety, `nodeTypes` push-down, full BM25+RRF end-to-end driven by a wired `SearchWorkflow`. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/ports/IDocumentStore.ts` | Add `searchContentKeyword(query, k, filter?)` to the interface. |
| 2 | `src/sidecar/adapters/SqliteDocumentStore.ts` | Implement `searchContentKeyword` via `nodes_fts MATCH ? ORDER BY bm25(nodes_fts) LIMIT ?`; honor `NodeFilter.nodeTypes` and any existing pushdowns the adapter already supports on `NodeFilter` (e.g. `subtreeRootNodeIds`); use the new sanitizer for the MATCH argument. |
| 3 | `src/core/workflows/SearchWorkflow.ts` | Introduce shared coarse-retrieval helper; when `enableHybridSearch` is true, run BM25 + vector in parallel and fuse via `rrf.ts`; pass through `pathGlobs`/`dateRange`/`tags` to both legs and to the content-only fallback. |
| 4 | `src/core/workflows/ChatWorkflow.ts` | Route through the same shared helper; accept `enableHybridSearch` on `ChatWorkflowOptions`. |
| 5 | `src/core/domain/types.ts` | Add `enableHybridSearch?: boolean` to `SearchRequest` and `ChatWorkflowOptions`. |
| 6 | `src/plugin/settings/defaults.ts` | Add `DEFAULT_ENABLE_HYBRID_SEARCH = true` and include it in default settings. |
| 7 | `src/plugin/settings/SettingsTab.ts` | Add the `enableHybridSearch` toggle with persistence. |
| 8 | `src/sidecar/runtime/SidecarRuntime.ts` | Thread `enableHybridSearch` from settings into chat/search retrieval options alongside `coarseK`; ensure both `handleChatStream` and `handleSearch` read it from the same source. |
| 9 | `src/sidecar/http/httpServer.ts`, `src/sidecar/stdio/stdioServer.ts` | Forward optional `enableHybridSearch` from the chat/search payload envelope (for explicit per-request override; settings value remains the default). |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/db/migrations/002_fts.sql` — authored by [STO-4](STO-4.md); RET-5 only queries the virtual table it creates.
- `src/sidecar/db/migrate.ts` — migration bookkeeping owned by STO-4.
- `src/core/domain/contextAssembly.ts` — Phase 3 assembly unchanged; hybrid fusion is a coarse-phase concern per ADR-012.
- `src/core/workflows/SearchWorkflow.ts::mapSearchK` proper — the `coarseK` plumbing is already owned by RET-4; RET-5 consumes it.

---

## 8. Acceptance Criteria Checklist

### Phase A: Store-level BM25 via FTS5

- [x] **A1** — `SqliteDocumentStore.searchContentKeyword('Acme Corp', 10)` returns rows ordered by BM25 against a fixture vault in which multiple notes mention "Acme Corp"; the note that mentions the token most prominently ranks first.
  - Verification: run against a freshly migrated SQLite DB (migrations 001 + 002 applied) populated with three fixture notes; assert ordering.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A1_bm25_results_real_fts5(vitest)`
- [x] **A2** — The MATCH query is sanitized: user inputs containing `"`, `*`, `(`, `)`, `:`, `-`, or `^` do not throw, do not match operator syntax unintentionally, and do not crash the FTS5 parser.
  - Verification: parametrize over six unsafe inputs; each call must succeed and return results consistent with a literal-token interpretation.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A2_sanitize_match_syntax(vitest)`
- [x] **A3** — When called with `filter = { nodeTypes: ['note','topic','subtopic'] }`, `searchContentKeyword` returns zero rows of `type = 'bullet'` or `type = 'paragraph'`, even if those rows would have higher BM25.
  - Verification: fixture vault contains both summary-bearing and leaf nodes with the same token.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A3_nodeTypes_filter_pushdown(vitest)`

### Phase B: Pure RRF fusion

- [x] **B1** — `fuseRankings([listA, listB])` produces a deterministic fused ranking using the RRF formula `score(d) = Σ 1 / (60 + rank_r(d))`; a fixture where document `X` is rank 1 on `listA` and rank 10 on `listB` fuses above document `Y` at ranks 3 and 15.
  - Evidence: `tests/core/domain/rrf.test.ts::B1_fused_order_deterministic(vitest)`
- [x] **B2** — RRF tie-breaking rule is documented in `rrf.ts` and exercised by a test (two documents with identical fused scores are returned in a stable, documented order).
  - Evidence: `tests/core/domain/rrf.test.ts::B2_tie_break(vitest)`

### Phase C: Workflow fusion, toggle, filter pass-through, grounding handoff

- [x] **C1** — With `enableHybridSearch: true`, `SearchWorkflow` calls **both** `searchSummaryVectors(qv, coarseK)` and `searchContentKeyword(query, coarseK, { nodeTypes: ['note','topic','subtopic'], ...userFilters })`, and the top `coarseK` subtree roots driving Phase 2 are those with the best RRF fused rank.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C1_hybrid_on_issues_both_legs_and_fuses(vitest)`
- [x] **C2** — With `enableHybridSearch: false`, `SearchWorkflow` issues **zero** calls to `searchContentKeyword`; the coarse candidate ranking exactly matches the pre-hybrid vector-only baseline for the same fixture.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C2_hybrid_off_vector_only_no_bm25(vitest)`
- [x] **C3** — The BM25 filter passed by `SearchWorkflow` to `searchContentKeyword` always restricts `nodeTypes` to `['note','topic','subtopic']`; a test asserts the spied filter argument on the fake store. Phase 2's call to `searchContentVectors` does **not** carry that restriction.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C3_bm25_restricted_to_summary_types(vitest)`
- [x] **C4** — Given a fixture where a note containing an exact-keyword token (e.g. "Acme Corp") is outside the top 8 vector-summary hits but first on BM25, hybrid fusion places the note inside the coarse-phase cutoff and Phase 2 is invoked on its subtree.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C4_exact_keyword_recovered_by_bm25(vitest)`
- [x] **C5** — When the content-only fallback fires (per RET-4) and user-supplied `pathGlobs` / `dateRange` are set on the request, the fallback call to `searchContentVectors` is invoked with those filters still present; a spy asserts the filter argument. "Unrestricted" only drops the `subtreeRootNodeIds` narrowing.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C5_fallback_preserves_user_filters(vitest)`
- [x] **C6** — When hybrid coarse retrieval plus the content-only fallback together return zero candidates after user filters, `SearchWorkflow` returns `results: []` and the existing insufficient-evidence path from [REQ-001](../requirements/REQ-001-grounding-policy.md) fires downstream; no fabricated sources are produced.
  - Evidence: `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C6_empty_after_filters_routes_to_grounding(vitest)`
- [x] **C7** — `ChatWorkflow` invoked from `SidecarRuntime.handleChatStream` uses the same shared retrieval helper as `SearchWorkflow`; the `enableHybridSearch` value threaded from settings reaches the shared helper on a chat request.
  - Evidence: `tests/core/workflows/ChatWorkflow.hybrid.test.ts::C7_chat_shares_retrieval_helper_and_toggle(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `src/core/domain/rrf.ts` contains no imports from `src/sidecar/**`, `src/plugin/**`, or any I/O module; the boundary script confirms.
  - Evidence: `scripts/check-source-boundaries.mjs(npm run check:boundaries)`
- [x] **Y2** — **(binding)** The `IDocumentStore` contract suite for `searchContentKeyword` passes against `SqliteDocumentStore`: BM25 ordering, `nodeTypes` filter push-down, and `score`-as-BM25 semantics.
  - Evidence: `tests/contract/document-store.contract.ts::searchContentKeyword_contract(vitest)`
- [x] **Y3** — **(binding)** The integration test for `SqliteDocumentStore` exercises the full BM25 + RRF coarse-phase path against a real `better-sqlite3` + FTS5 database (migrations 001 + 002 applied, no mocking of the boundary owned by the adapter) and confirms a fixture where a token-only match is surfaced by hybrid but missed by vector-only.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::Y3_bm25_plus_rrf_end_to_end_real_sqlite(vitest)`
- [x] **Y4** — **(binding)** With `enableHybridSearch: false`, the integration test confirms zero FTS5 queries are issued against the real SQLite database for a chat/search request (verified by a SQL-level counter or a temporary FTS5 query spy on the adapter).
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::Y4_hybrid_off_no_fts5_query(vitest)`
- [x] **Y5** — **(binding)** RRF constant `k = 60` is a single named constant in `src/core/domain/rrf.ts` and is not configurable from workflow options or settings; a grep test confirms no other `k = …` value is passed into the fuser.
  - Evidence: `tests/core/domain/rrf.test.ts::Y5_fixed_k60_constant(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A** (no new shared/client split introduced by this story)
- [x] **Z5** — New or modified code logs at `debug` level, per request: BM25 candidate count, vector candidate count, fused top-K count, `enableHybridSearch` toggle state, and whether the content-only fallback fired
- [x] **Z6** — `/review-story RET-5` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output)

---

## 8a. Test Plan

Every in-scope REQ-004 `Sn` (S1, S2, S3, S4, S12, S13, S14, S15) is covered. Every AC ID from Section 8 (A1–A3, B1–B2, C1–C7, Y1–Y5, Z1–Z6) appears in the **Covers AC** column of at least one row. Contract + integration rows for the `IDocumentStore` / `SqliteDocumentStore` pair are present per the hexagonal rule.

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/rrf.test.ts::B1_fused_order_deterministic` | B1 | S3 | Pure RRF helper; fixture two-list fusion. |
| 2 | unit | `tests/core/domain/rrf.test.ts::B2_tie_break` | B2 | S3 | Stable/documented tie-break rule. |
| 3 | unit | `tests/core/domain/rrf.test.ts::Y5_fixed_k60_constant` | Y5 | S3 | Named constant; no per-caller override. |
| 4 | unit | `tests/core/domain/fts-sanitize.test.ts::sanitize_operator_chars` | A2 | S4 | Sanitizer unit coverage for `"` `*` `()` `:` `-` `^`. |
| 5 | unit | `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C1_hybrid_on_issues_both_legs_and_fuses` | C1 | S1 | Fake store, spy on both legs + RRF merge. |
| 6 | unit | `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C2_hybrid_off_vector_only_no_bm25` | C2 | S2 | Toggle off: zero BM25 calls. |
| 7 | unit | `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C3_bm25_restricted_to_summary_types` | C3 | S15 | Spied filter arg includes `nodeTypes: ['note','topic','subtopic']`. |
| 8 | unit | `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C4_exact_keyword_recovered_by_bm25` | C4 | S13 | Fake store: vector misses, BM25 rank 1 → RRF surfaces the note. |
| 9 | unit | `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C5_fallback_preserves_user_filters` | C5 | S14 | Fallback call retains `pathGlobs` / `dateRange`. |
| 10 | unit | `tests/core/workflows/SearchWorkflow.hybrid.test.ts::C6_empty_after_filters_routes_to_grounding` | C6 | S12 | Empty candidate set → `results: []` handoff. |
| 11 | unit | `tests/core/workflows/ChatWorkflow.hybrid.test.ts::C7_chat_shares_retrieval_helper_and_toggle` | C7 | S1, S2 | Chat/search parity on the helper and the toggle. |
| 12 | contract | `tests/contract/document-store.contract.ts::searchContentKeyword_contract` | Y2 | S1, S4, S13, S15 | Generic suite; any adapter for `IDocumentStore` must pass. |
| 13 | integration | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A1_bm25_results_real_fts5` | A1 | S1, S4, S13 | Real `better-sqlite3` + FTS5; fixture-driven BM25 ordering. |
| 14 | integration | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A2_sanitize_match_syntax` | A2 | S4 | Real FTS5 parser does not crash on unsafe tokens after sanitizer. |
| 15 | integration | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::A3_nodeTypes_filter_pushdown` | A3 | S15 | Real FTS5 + SQL predicate drops leaves. |
| 16 | integration | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::Y3_bm25_plus_rrf_end_to_end_real_sqlite` | Y3 | S1, S3, S13 | **Binding.** End-to-end `SearchWorkflow` + real SQLite + real FTS5 proves hybrid surfaces a keyword-only hit. |
| 17 | integration | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::Y4_hybrid_off_no_fts5_query` | Y4 | S2 | SQL-level counter confirms no FTS5 query when toggle is false. |
| 18 | integration | `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts::C5_fallback_preserves_filters_real_sqlite` | C5 | S14 | Real SQLite: fallback ANN still carries `pathGlobs` predicate (subtree-root filter is the only thing dropped). |
| 19 | static | `scripts/check-source-boundaries.mjs(npm run check:boundaries)` | Y1 | — | Guards `rrf.ts` boundary; no imports from sidecar/plugin. |
| 20 | static | `npm run build` + `npm run lint` + `npm run typecheck` | Z1, Z2, Z3 | — | Standard quality gates over changed surface. |
| 21 | static | Logging audit on modified files (manual + lint rule on new files) | Z5 | — | Confirms per-request hybrid telemetry. |
| 22 | review | `/review-story RET-5` machine-checkable summary line | Z6 | — | Zero `high`/`critical` TEST-/SEC-/REL-/API- findings. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | FTS5 tokenizer (`unicode61 remove_diacritics 2`) misses CJK segmentation, stemming, or domain-specific tokens. | ADR-012 fixes unicode61 for MVP; a later story may introduce tokenizers without re-entering the fusion algorithm. |
| 2 | Keyword-heavy queries drown out semantic hits under RRF. | RRF operates on ranks, not scores; `k = 60` (Cormack/Clarke/Büttcher default) is well-behaved across retrieval IR literature. Revisit only on telemetry evidence. |
| 3 | Filter pass-through bug: `pathGlobs` / `dateRange` applied to one leg but not the other. | Shared `NodeFilter` object constructed once and passed to both legs; unit tests assert the spied filter argument on both store calls and on the fallback. |
| 4 | Chat and search diverge on the toggle (e.g. chat payload omits `enableHybridSearch`). | Both route through the same shared retrieval helper; `ChatWorkflow.hybrid.test.ts` covers parity; ADR-012 Decision 6 is a binding rule. |
| 5 | Hybrid toggle off still issues an FTS5 query (dead code path). | Y4 integration test asserts zero FTS5 queries when the toggle is false. |
| 6 | Sanitizer regresses and passes operator characters through to FTS5. | Unit + integration tests with the specific character class; FTS5 parser errors fail the test explicitly. |
| 7 | `coarseK` (RET-4) and `enableHybridSearch` (RET-5) become inconsistent between callers. | Both are read from the same settings object per request in `SidecarRuntime`; shared helper enforces a single point of truth. |

---

## Implementation Order

1. `src/core/domain/rrf.ts` + `tests/core/domain/rrf.test.ts` — pure fuser, fixed `k = 60`. (Covers B1, B2, Y5.)
2. `src/core/domain/fts-sanitize.ts` + `tests/core/domain/fts-sanitize.test.ts` — pure sanitizer. (Covers A2 unit side.)
3. `src/core/ports/IDocumentStore.ts` — add `searchContentKeyword`. (Covers Y2 contract-surface side.)
4. `src/sidecar/adapters/SqliteDocumentStore.ts` — implement `searchContentKeyword` against `nodes_fts`; honor `NodeFilter.nodeTypes`. (Covers A1, A3 implementation side.)
5. `tests/contract/document-store.contract.ts` + `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts` — contract + integration suites wired up against a real SQLite DB with migration 002_fts.sql applied. (Covers Y2, Y3, A1, A2, A3.)
6. **Verify** — `npm run test:integration -- SqliteDocumentStore.fts` passes; boundary check is green.
7. `src/core/domain/types.ts` — extend `SearchRequest` / `ChatWorkflowOptions` with `enableHybridSearch?: boolean`.
8. `src/core/workflows/SearchWorkflow.ts` — introduce shared coarse-retrieval helper; call BM25 + vector in parallel when enabled; fuse via RRF; pass filters through; keep fallback. (Covers C1–C6.)
9. `src/core/workflows/ChatWorkflow.ts` — route through the shared helper; accept `enableHybridSearch`. (Covers C7.)
10. `src/plugin/settings/defaults.ts` + `src/plugin/settings/SettingsTab.ts` — add `enableHybridSearch` toggle (default true).
11. `src/sidecar/runtime/SidecarRuntime.ts` — read `enableHybridSearch` from settings on every chat/search request; pass through alongside `coarseK`. Update `src/sidecar/http/httpServer.ts` and `src/sidecar/stdio/stdioServer.ts` to forward the optional override from the payload.
12. **Verify** — `tests/core/workflows/SearchWorkflow.hybrid.test.ts` + `tests/core/workflows/ChatWorkflow.hybrid.test.ts` pass; end-to-end integration asserts hybrid-on surfaces a keyword hit vector-only misses (Y3) and hybrid-off issues no FTS5 query (Y4).
13. **Final verify** — `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run check:boundaries` all green; `/review-story RET-5` reports zero `high`/`critical` TEST/SEC/REL/API findings (Z6).

---

*Created: 2026-04-20 | Story: RET-5 | Epic: 5 — Retrieval, search workflow, and chat workflow*
