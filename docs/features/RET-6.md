# RET-6: Temporal and path filters for retrieval

**Story**: Extend `SearchRequest` and chat retrieval options with optional `pathGlobs` and `dateRange` filters; compile globs to SQL `LIKE`/regex predicates in `SqliteDocumentStore`; parse daily-note filenames into the new `note_meta.note_date` column during indexing and apply date-range filters against it; surface the filters in the chat UI via lightweight slash-command parsing.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Open

---

## 1. Summary

Users who keep daily notes cannot currently ask "what job-search activities did I do in the last two weeks?" with any reliability: semantic search over entire vaults is too broad, and the phased retrieval has no first-class way to pre-filter by path or date. [REQ-004](../requirements/REQ-004-hybrid-and-filters.md) refines the product requirement for temporal / path filters, and [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) defines the binding contract (new `SearchRequest` fields, daily-note filename parsing, pushed-down SQL predicates, NULL `note_date` exclusion). This story implements that contract end-to-end through the sidecar's `IDocumentStore` port + `SqliteDocumentStore` adapter, plus the chat-input slash-command parser.

Filter application:

- `pathGlobs`: compiled once to a regex + SQL `LIKE` fragment pair and pushed into every retrieval call (Phase 1 summary ANN, Phase 2 content ANN, and the ADR-012 content-only fallback) — never post-processed after ranking.
- `dateRange`: applied via a new `note_meta.note_date DATE NULL` column (schema-owned by [STO-4](STO-4.md)) populated during indexing from daily-note filename matches; filter becomes `AND note_meta.note_date BETWEEN ? AND ?`, with `NULL note_date` excluded whenever `dateRange` is present.

The key design principle is "filters are a store concern, not a workflow concern": both predicates flow through `NodeFilter` into the `IDocumentStore` port so every adapter (today `SqliteDocumentStore`, tomorrow whatever else) enforces them uniformly. The workflow only threads the options through.

**Prerequisites:** [RET-4](RET-4.md) (shared retrieval helper that already carries `SearchAssemblyOptions`), [STO-4](STO-4.md) (migration adds `note_date` column + index alongside FTS5), [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) **Accepted**.

### In scope — scenarios from REQ-004 implemented here

This story implements the REQ-004 scenarios tagged `Implemented by: RET-6` (alone or jointly):

- **S5** — single `pathGlob` scopes the candidate set to matching notes only (RET-6 only).
- **S6** — multiple `pathGlobs` are unioned (RET-6 only).
- **S7** — `dateRange` restricts the candidate set inclusively on both endpoints (shared with STO-4; RET-6 owns the filter application, STO-4 owns the column).
- **S8** — notes with `note_date = NULL` are excluded when `dateRange` is set (shared with STO-4; RET-6 owns the exclusion at query time).
- **S9** — `dailyNotePathGlobs` + `dailyNoteDatePattern` determine which notes get a parsed `note_date` (shared with STO-4; RET-6 owns the indexer-side parser + population, STO-4 owns the column declaration).
- **S10** — combining `pathGlobs` and `dateRange` AND-intersects them (RET-6 only).
- **S11** — the chat input accepts slash-command-style filter hints that are extracted before the request is sent (RET-6 only).
- **S12** — when filters collapse the candidate set to zero, the existing insufficient-evidence response from [REQ-001](../requirements/REQ-001-grounding-policy.md) fires unchanged (shared with RET-5; RET-6 owns the filter-side empty-result handoff).
- **S14** — `pathGlobs` and `dateRange` are still applied when the ADR-012 content-only fallback fires (shared with RET-5; RET-6 owns the filter push-down into the fallback call).

### Out of scope — REQ-004 scenarios owned by other stories

These REQ-004 scenarios are **not** implemented by this story. They are tagged `Implemented by:` exclusively for RET-5 and/or STO-4, and are listed here solely to make the story boundary unambiguous:

| Sn  | Owner(s)        | Why it is out of scope for RET-6 |
|-----|-----------------|----------------------------------|
| S1  | RET-5, STO-4    | Hybrid BM25+vector RRF fusion is the RET-5 workflow story; STO-4 builds the FTS5 virtual table. RET-6 is filter-shape only and is orthogonal to whether coarse retrieval uses BM25. |
| S2  | RET-5           | The `enableHybridSearch = false` vector-only baseline is a RET-5 toggle behavior; no filter contract touches it. |
| S3  | RET-5           | RRF uses the fixed `k = 60` constant — RET-5 binding constraint, no filter interaction. |
| S4  | STO-4, RET-5    | FTS5 virtual table declaration + migration additivity is STO-4 schema work; RET-5 consumes it. |
| S13 | RET-5           | Hybrid surfacing an exact-keyword hit that vector-only misses is a RET-5 retrieval-quality outcome; independent of filters. |
| S15 | RET-5           | Restricting coarse BM25 to `note / topic / subtopic` is a RET-5 `NodeFilter.nodeTypes` rule; RET-6 contributes no filter-type logic here. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Defines the entire filter surface for this story: `pathGlobs` + `dateRange` on `SearchRequest`, daily-note filename parsing via `dailyNotePathGlobs` + `dailyNoteDatePattern`, NULL `note_date` exclusion, intersection semantics, and push-down before ANN. |
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | Binds S14: the content-only fallback still respects user filters ("unrestricted" means "no subtree-root filter", not "no user filter"). |
| [`docs/decisions/ADR-003-phased-retrieval-strategy.md`](../decisions/ADR-003-phased-retrieval-strategy.md) | Filter is an additional predicate applied in Phase 1 and Phase 2 alike; no new phases. |
| [`docs/decisions/ADR-002-hierarchical-document-model.md`](../decisions/ADR-002-hierarchical-document-model.md) | `note_meta` is the canonical home for per-note scalar metadata, including the new `note_date` column that `dateRange` filters against. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | When filters collapse the candidate set to zero (S12), the insufficient-evidence response defined here is what fires — this story must not introduce a separate empty-result path. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted** (ADR-014, ADR-012, ADR-003, ADR-002, ADR-011 all Accepted)
- [x] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [x] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [x] Section 4b (Ports & Adapters) lists every port/adapter this story creates or modifies
- [x] Section 8a (Test Plan) is filled and **every AC ID** (including Phase Y and Phase Z) is referenced by at least one planned test row
- [x] For every adapter in Section 4b, Section 8a contains both a **contract test against the port** and an **integration test against the real backing service** (no mock of the boundary the adapter owns), and Phase Y has a `(binding)` criterion citing the integration test file
- [x] Every Gherkin `Sn` ID from REQ-004 tagged `Implemented by: RET-6` is mapped to at least one acceptance test row in Section 8a; REQ-004 `Sn`s owned by RET-5 / STO-4 are listed as out-of-scope in §1 with the owner and reason
- [x] Phase Y includes at least one criterion with **non-mock** evidence where wrong-stack substitution is a risk (real `better-sqlite3` integration against `SqliteDocumentStore`)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `SearchRequest` gains `pathGlobs?: string[]` and `dateRange?: { start?: string; end?: string }` (ISO `YYYY-MM-DD`). `ChatWorkflowOptions` mirrors the same two fields. Both are optional; omitting them preserves current behavior. (ADR-014 Decision 1.)
2. **Y2** — Path-glob matching uses a small compile step (`src/core/domain/pathGlob.ts`) that turns globs like `Daily/**/*.md` into a regex + SQL `LIKE` fragment pair. `**` → any, `*` → non-slash, `?` → single non-slash. (ADR-014 Decision 2; REQ-004 Resolved #9.)
3. **Y3** — Every Phase 1 and Phase 2 SQL query built for a filtered call includes the glob predicate on `notes.path` and the date predicate on `note_meta.note_date`, pushed down **before** ANN scoring. The ADR-012 content-only fallback call inherits the same predicates. (ADR-014 Decision 2, Decision 3, Decision 6; REQ-004 Constraints §5 "filters are pushed down".)
4. **Y4** — Daily-note date parsing runs during indexing: for each note whose path matches `settings.dailyNotePathGlobs` (default `['Daily/**/*.md']`), extract a date using `settings.dailyNoteDatePattern` (default `YYYY-MM-DD`) from the basename; store in `note_meta.note_date`. Non-matching notes get `NULL`. Pattern tokens supported in MVP: `YYYY`, `MM`, `DD`. (ADR-014 Decision 4.)
5. **Y5** — When `dateRange` is present and a note's `note_date` is NULL, that note is excluded from the filter's candidate set (NULL is not within any range). This exclusion applies uniformly at Phase 1, Phase 2, and in the content-only fallback. (ADR-014 Decision 3; REQ-004 Resolved #11.)
6. **Y6** — Filters are **additive**: both `pathGlobs` and `dateRange` may appear in the same request; results must satisfy **both**. Within `pathGlobs`, multiple globs are unioned (match any). (ADR-014 Decision 2 and Decision 3 together; REQ-004 Constraints §5 "intersection" / "union".)
7. **Y7** — Filter application is owned by the `IDocumentStore` port. Workflow code threads `pathGlobs` / `dateRange` into `NodeFilter` and passes it to the store; no workflow-side post-filtering of ANN results is permitted. Silent substitution of the SQLite adapter for an in-memory filter in chat or search is forbidden. (ADR-014 Decision 2; REQ-004 Constraints §5 "pushed down to SQLite before ANN scoring".)
8. **Y8** — When coarse retrieval returns zero candidates solely because of filters, the workflow hands off to the existing insufficient-evidence response from [REQ-001](../requirements/REQ-001-grounding-policy.md) / [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md). This story must not add a new empty-result UI. (REQ-004 S12; ADR-014 Consequences.)

---

## 4b. Ports & Adapters

This story modifies the `IDocumentStore` port (extends `NodeFilter` with `pathRegex` / `pathLike` + `dateRange`; no new methods) and its sole adapter `SqliteDocumentStore` (compiles the new filter fields into SQL `WHERE` fragments pushed into `searchSummaryVectors`, `searchContentVectors`, and the fallback call). Filter application is a **store concern**, so both rows are required.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IDocumentStore` | [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts) | `SqliteDocumentStore` ([`src/sidecar/adapters/SqliteDocumentStore.ts`](../../src/sidecar/adapters/SqliteDocumentStore.ts)) | local `better-sqlite3` DB opened against a temp vault fixture on disk (e.g. `var/test/ret6-*.db`) | **Modified** in this story: `NodeFilter` type gains `pathRegex?: string`, `pathLike?: string`, `dateRange?: { start?: string; end?: string }`. No new methods. |
| `IDocumentStore` (indexer-side surface) | [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts) (`upsertNoteMeta`) | `SqliteDocumentStore` ([`src/sidecar/adapters/SqliteDocumentStore.ts`](../../src/sidecar/adapters/SqliteDocumentStore.ts)) | same fixture DB as above, exercised via the indexer pipeline | **Modified**: `NoteMeta` gains `noteDate: string \| null`; the SQLite adapter persists it into the STO-4-owned `note_meta.note_date` column and reads it back into `getNoteMeta`. |

Contract coverage: the existing `IDocumentStore` contract test suite (run against every adapter) gains cases for the new filter fields and for `noteDate` round-trip. Integration coverage: the `SqliteDocumentStore` integration test gains the filter-SQL and `note_date` population cases listed in Section 8a.

---

## 5. API Endpoints + Schemas

Type additions (in [`src/core/domain/types.ts`](../../src/core/domain/types.ts)):

```ts
export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
  tags?: string[];
  coarseK?: number;
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
}

export interface ChatWorkflowOptions {
  search: SearchAssemblyOptions;
  apiKey?: string;
  coarseK?: number;
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
}

export interface NodeFilter {
  nodeTypes?: NodeType[];
  tagsAny?: string[];
  subtreeRootNodeIds?: string[];
  pathRegex?: string;
  pathLike?: string;
  dateRange?: { start?: string; end?: string };
}

export interface NoteMeta {
  noteId: string;
  vaultPath: string;
  title: string;
  noteDate: string | null;
}
```

Sidecar message protocol: extend the `search` and `chat` request payloads (documented in README §Protocol) with the same two optional fields (`pathGlobs`, `dateRange`).

Schema (authored by [STO-4](STO-4.md); consumed here):

```sql
ALTER TABLE note_meta ADD COLUMN note_date TEXT; -- ISO YYYY-MM-DD, NULL when not parsed
CREATE INDEX IF NOT EXISTS idx_note_meta_note_date ON note_meta(note_date);
```

New settings: `dailyNotePathGlobs: string[]` (default `['Daily/**/*.md']`), `dailyNoteDatePattern: string` (default `'YYYY-MM-DD'`).

No new endpoints; no changes to REST/HTTP shapes beyond the optional payload fields above.

---

## 6. Frontend Flow

Chat input gains slash-command-style filter parsing in [`ChatView`](../../src/plugin/ui/ChatView.ts). Settings tab gains two fields for daily-note configuration. No new views or components.

### 6a. Component / Data Hierarchy

```
ChatView
└── input box
    └── parseChatInput(raw) → { text, pathGlobs?, dateRange? }
        └── chat payload (pathGlobs, dateRange, text)

SettingsTab
└── Advanced retrieval section
    ├── dailyNotePathGlobs (string[])
    └── dailyNoteDatePattern (string)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `parseChatInput` | `(raw: string) => { text: string; pathGlobs?: string[]; dateRange?: { start?: string; end?: string } }` | pure | Accepts `path:Daily/**/*.md`, `since:2026-04-01`, `before:2026-04-10`, `last:14d`. Unknown tokens left in `text`. |
| `ChatView` input handler | `onSubmit(raw)` | forwards parsed `{ text, pathGlobs, dateRange }` into the `chat` sidecar payload | stripped filter tokens no longer appear in downstream `text` |
| `SettingsTab` | read/write `dailyNotePathGlobs`, `dailyNoteDatePattern` | debounced save | Advanced section; sensible defaults; reindex prompt on change. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Normal chat loading spinner; filter application is synchronous at parse time and does not block the UI. |
| Error — glob parse failure | Inline warning toast in chat ("invalid path glob, sending query unfiltered"); the raw hint is left in the text and the request proceeds without `pathGlobs`. |
| Error — date parse failure | Inline warning toast in chat ("invalid date filter, sending query unfiltered"); the request proceeds without `dateRange`. |
| Empty — filters collapse candidates to zero | Insufficient-evidence response from [REQ-001](../requirements/REQ-001-grounding-policy.md) fires unchanged; no separate empty-filter UI. |
| Success | Filters applied silently; the reply is rendered as a normal answered reply. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/pathGlob.ts` | Pure helper: compile glob → `{ regex: string; like: string }`. |
| 2 | `src/core/domain/dailyNoteDate.ts` | Pure helper: parse basename + pattern → ISO date string or `null`. |
| 3 | `src/core/domain/chatInputParser.ts` | Pure `parseChatInput` — slash-command-style filter extraction. |
| 4 | `tests/core/domain/pathGlob.test.ts` | Glob translation unit cases (incl. `Daily/**/*.md`, `*`, `?`, non-matches). |
| 5 | `tests/core/domain/dailyNoteDate.test.ts` | Date parsing unit cases (`YYYY-MM-DD`, custom `YYYY_MM_DD`, non-matches, invalid calendar dates). |
| 6 | `tests/core/domain/chatInputParser.test.ts` | Input parsing edge cases (`path:`, `since:`, `before:`, `last:Nd`, unknown tokens). |
| 7 | `tests/core/workflows/SearchWorkflow.filters.test.ts` | Workflow threads filters into Phase 1, Phase 2, and fallback (via fake store). |
| 8 | `tests/core/workflows/ChatWorkflow.filters.test.ts` | Chat workflow forwards filters through shared retrieval helper. |
| 9 | `tests/plugin/ui/ChatView.filters.test.ts` | `ChatView` sends parsed `pathGlobs` / `dateRange` in the `chat` payload. |
| 10 | `tests/contract/document-store.filters.contract.ts` | Generic contract suite — any `IDocumentStore` implementation must honor the new filter fields. |
| 11 | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts` | **Integration**: real `better-sqlite3`; filtered queries exclude out-of-scope rows; `note_date` populated; NULL excluded. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | Extend `SearchRequest`, `ChatWorkflowOptions`, `NodeFilter`, `NoteMeta` per §5. |
| 2 | `src/core/ports/IDocumentStore.ts` | Document the new `NodeFilter` fields and `NoteMeta.noteDate` contract (no new methods). |
| 3 | `src/core/workflows/SearchWorkflow.ts` | Thread filters into `NodeFilter` for Phase 1, Phase 2, and content-only fallback; no post-filter. |
| 4 | `src/core/workflows/ChatWorkflow.ts` | Accept filters in `ChatWorkflowOptions`; forward through the shared retrieval helper. |
| 5 | `src/sidecar/adapters/SqliteDocumentStore.ts` | Append `pathLike` / `pathRegex` / `dateRange` predicates in SQL; persist + read `note_date` in `note_meta`; thread filters into the content-only fallback query. |
| 6 | `src/sidecar/runtime/SidecarRuntime.ts` | Call `dailyNoteDate` parser during indexing; write `noteDate` via `upsertNoteMeta`; thread `pathGlobs` / `dateRange` from `chat` / `search` payload into workflow options. |
| 7 | `src/sidecar/http/httpServer.ts`, `src/sidecar/stdio/stdioServer.ts` | Pass `pathGlobs` / `dateRange` from request payload to handlers. |
| 8 | `src/plugin/ui/ChatView.ts` | Call `parseChatInput` on submit; include filters in `chat` payload. |
| 9 | `src/plugin/settings/SettingsTab.ts` | Add `dailyNotePathGlobs` + `dailyNoteDatePattern` (advanced section); persist. |
| 10 | `src/plugin/settings/types.ts` | Add the two new setting fields with defaults. |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/db/migrations/002_fts.sql` — STO-4 owns the `note_date` column + index as part of its additive migration; RET-6 consumes it but does not author schema.
- `src/core/workflows/IndexWorkflow.ts` — workflow shape is unchanged; only the sidecar runtime glue that calls `upsertNoteMeta` is modified.
- ADR-012 / ADR-014 text — unchanged; this story implements them, does not amend them.

---

## 8. Acceptance Criteria Checklist

### Phase A: Pure helpers

- [ ] **A1** — `compilePathGlob('Daily/**/*.md')` produces a regex matching `Daily/2026-04-16.md` and `Daily/sub/2026-04-16.md`, and rejecting `Other/notes.md` and `Daily/2026-04-16.txt`.
  - Detailed: also returns a SQL `LIKE` fragment that the adapter uses as a fast first-pass filter; `**` → any, `*` → non-slash, `?` → single non-slash.
  - Evidence: `tests/core/domain/pathGlob.test.ts::A1_daily_glob(vitest)`

- [ ] **A2** — `parseDailyNoteDate('2026-04-16', 'YYYY-MM-DD')` returns `'2026-04-16'`; a non-matching basename (e.g. `'planning'`) returns `null`; an invalid calendar date (e.g. `'2026-13-40'`) returns `null`.
  - Evidence: `tests/core/domain/dailyNoteDate.test.ts::A2_parse_and_reject(vitest)`

- [ ] **A3** — `parseChatInput('what did I do? path:Daily/**/*.md last:14d')` returns `text = 'what did I do?'`, `pathGlobs = ['Daily/**/*.md']`, and `dateRange.start = today - 14 days` (ISO). Unknown tokens remain in `text`.
  - Evidence: `tests/core/domain/chatInputParser.test.ts::A3_extracts_path_and_last(vitest)`

- [ ] **A4** — `parseChatInput` also handles `since:2026-04-01` and `before:2026-04-10` into the corresponding `start` / `end` endpoints; combining `since:` and `before:` produces both endpoints.
  - Evidence: `tests/core/domain/chatInputParser.test.ts::A4_since_before(vitest)`

### Phase B: Store filtering (contract + SQLite)

- [ ] **B1** — With `NodeFilter.pathRegex` set to `^Daily/`, `searchContentVectors` returns only rows whose `notes.path` matches; rows under `Work/` and `Research/` are absent. Contract suite runs against any adapter; integration test runs against real `better-sqlite3`.
  - Detailed: verifies S5 — a single `pathGlob` scopes the candidate set; `**` / `*` / `?` glob-to-regex semantics preserved end-to-end.
  - Evidence (contract): `tests/contract/document-store.filters.contract.ts::B1_single_glob(vitest)`
  - Evidence (integration): `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B1_single_glob_sqlite(vitest)`

- [ ] **B2** — With `NodeFilter.pathRegex` encoding a union of `Daily/**` and `Journal/**`, a note matching either glob is returned; a note matching neither is excluded. (S6.)
  - Evidence (contract): `tests/contract/document-store.filters.contract.ts::B2_union_globs(vitest)`
  - Evidence (integration): `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B2_union_globs_sqlite(vitest)`

- [ ] **B3** — With `NodeFilter.dateRange = { start: '2026-02-01', end: '2026-02-28' }`, `searchContentVectors` returns only rows whose `note_meta.note_date` lies inclusively within the range; `2026-01-31` and `2026-03-01` are excluded. (S7.)
  - Evidence (contract): `tests/contract/document-store.filters.contract.ts::B3_dateRange_inclusive(vitest)`
  - Evidence (integration): `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B3_dateRange_inclusive_sqlite(vitest)`

- [ ] **B4** — With `NodeFilter.dateRange` set, rows whose `note_meta.note_date IS NULL` are **excluded** from the candidate set, even if they would otherwise match the query semantically. (S8.)
  - Evidence (contract): `tests/contract/document-store.filters.contract.ts::B4_null_note_date_excluded(vitest)`
  - Evidence (integration): `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B4_null_note_date_excluded_sqlite(vitest)`

- [ ] **B5** — With both `pathRegex` and `dateRange` set, only rows satisfying **both** predicates are returned (AND-intersection). A `Daily/2026-02-14.md` passes; `Journal/2026-02-14.md` fails path; `Daily/2026-04-01.md` fails date. (S10.)
  - Evidence (contract): `tests/contract/document-store.filters.contract.ts::B5_intersection(vitest)`
  - Evidence (integration): `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B5_intersection_sqlite(vitest)`

- [ ] **B6** — **Indexer round-trip:** upserting a `NoteMeta` with a parsed `noteDate` for a `Daily/**/*.md` path persists it in `note_meta.note_date`; a note whose basename does not match `dailyNoteDatePattern` persists `NULL`; `getNoteMeta` returns the stored value unchanged. (S9 population side.)
  - Evidence (contract): `tests/contract/document-store.filters.contract.ts::B6_note_date_round_trip(vitest)`
  - Evidence (integration): `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B6_note_date_round_trip_sqlite(vitest)`

### Phase C: Workflow integration

- [ ] **C1** — `SearchWorkflow` threads `pathGlobs` / `dateRange` from the request into `NodeFilter` for **both** Phase 1 (`searchSummaryVectors`) and Phase 2 (`searchContentVectors`). A spy on the fake store asserts both calls saw the filter. (S5+S7 at the workflow level.)
  - Evidence: `tests/core/workflows/SearchWorkflow.filters.test.ts::C1_propagation_phase1_phase2(vitest)`

- [ ] **C2** — `SearchWorkflow`'s ADR-012 content-only fallback call also carries `pathGlobs` / `dateRange`; "unrestricted" drops only `subtreeRootNodeIds`, not the user filters. (S14.)
  - Evidence: `tests/core/workflows/SearchWorkflow.filters.test.ts::C2_fallback_keeps_filters(vitest)`

- [ ] **C3** — When filters collapse the combined candidate set (Phase 1 ∪ fallback) to zero, `SearchWorkflow` returns `results: []` and the chat path emits the REQ-001 insufficient-evidence response — verified via spy on the insufficient-evidence emitter. (S12.)
  - Evidence: `tests/core/workflows/SearchWorkflow.filters.test.ts::C3_empty_after_filters_triggers_ie(vitest)`

- [ ] **C4** — `ChatWorkflow` accepts `pathGlobs` / `dateRange` in `ChatWorkflowOptions` and forwards them through the shared retrieval helper — the same helper `SearchWorkflow` uses. A spy asserts chat and search receive identical filter objects for identical inputs.
  - Evidence: `tests/core/workflows/ChatWorkflow.filters.test.ts::C4_forwards_filters(vitest)`

- [ ] **C5** — `ChatView` parses input containing `path:Daily/**/*.md last:14d what are the open questions?` and sends a `chat` payload with `pathGlobs = ['Daily/**/*.md']`, `dateRange.start = today - 14d`, and `text = 'what are the open questions?'` (filter tokens stripped). (S11.)
  - Evidence: `tests/plugin/ui/ChatView.filters.test.ts::C5_chat_input_slash_commands(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `SearchRequest` and `ChatWorkflowOptions` expose `pathGlobs?: string[]` and `dateRange?: { start?: string; end?: string }` per ADR-014 Decision 1; omitting them preserves prior behavior (static + runtime check).
  - Evidence: `tests/core/domain/types.shape.test.ts::Y1_request_shape(vitest)` plus `tsc --noEmit` on `src/core/domain/types.ts`

- [ ] **Y2** — **(binding)** Pure domain helpers (`pathGlob.ts`, `dailyNoteDate.ts`, `chatInputParser.ts`) live in `src/core/domain/` with no forbidden imports (no `sqlite`, no `fs`, no `node:*`).
  - Evidence: `scripts/check-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y3** — **(binding)** Filters are pushed down as SQL predicates **before** ANN scoring in `SqliteDocumentStore` — verified by an integration test against real `better-sqlite3` that asserts out-of-scope rows are absent from `searchSummaryVectors`, `searchContentVectors`, and the unrestricted content-vector call used for the ADR-012 fallback. Covers `pathGlob` + `dateRange` + `NULL note_date` exclusion in one run. (ADR-014 Decision 2/3/6; REQ-004 Constraints §5.)
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::Y3_filters_pushed_down_all_paths(vitest)` — **real SQLite, not mocked**

- [ ] **Y4** — **(binding)** `NULL note_date` rows are excluded whenever `dateRange` is present; verified against real `better-sqlite3` in the integration test above.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B4_null_note_date_excluded_sqlite(vitest)`

- [ ] **Y5** — **(binding)** Indexing a fixture Daily folder populates `note_meta.note_date` for matching filenames and leaves it `NULL` otherwise — verified against real `better-sqlite3`.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::Y5_note_date_populated_by_indexing(vitest)`

- [ ] **Y6** — **(binding)** The `IDocumentStore` **contract test suite** runs against `SqliteDocumentStore` and any future adapter, proving any conforming adapter honors the new `pathRegex` / `pathLike` / `dateRange` / `noteDate` contract.
  - Evidence: `tests/contract/document-store.filters.contract.ts(vitest)` executed by `tests/sidecar/adapters/SqliteDocumentStore.contract.test.ts`

- [ ] **Y7** — **(binding)** Zero-result-after-filter paths emit the existing REQ-001 insufficient-evidence response and do not fabricate "answered from vault" chrome; asserted via workflow-level spy.
  - Evidence: `tests/core/workflows/SearchWorkflow.filters.test.ts::C3_empty_after_filters_triggers_ie(vitest)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A** for this story (no shared-types package consumption on the plugin UI side beyond existing imports).
- [ ] **Z5** — New or modified code includes appropriate logging: at `debug`, per chat/search request log the compact filter shape (`pathGlobs.length`, `dateRange.start`, `dateRange.end`, `fallbackFired`); at `warn`, log glob or date parse failures with the raw token.
- [ ] **Z6** — `/review-story RET-6` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output).

---

## 8a. Test Plan

One row per planned test. Every AC ID from Section 8 appears in **Covers AC**; every RET-6-tagged REQ-004 `Sn` appears in **Covers Sn** of at least one row. Contract-level rows prove the `IDocumentStore` port contract; integration-level rows prove the `SqliteDocumentStore` adapter against real `better-sqlite3`.

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|-----------------|-----------|-----------|-------|
| 1  | unit | `tests/core/domain/pathGlob.test.ts::A1_daily_glob` | A1 | S5, S6 | compile glob → regex + LIKE; `**` / `*` / `?` semantics |
| 2  | unit | `tests/core/domain/dailyNoteDate.test.ts::A2_parse_and_reject` | A2 | S9 | `YYYY-MM-DD` happy path + non-match + invalid calendar date |
| 3  | unit | `tests/core/domain/chatInputParser.test.ts::A3_extracts_path_and_last` | A3 | S11 | `path:` + `last:Nd` tokens extracted, text stripped |
| 4  | unit | `tests/core/domain/chatInputParser.test.ts::A4_since_before` | A4 | S11 | `since:` / `before:` combine into dateRange endpoints |
| 5  | contract | `tests/contract/document-store.filters.contract.ts::B1_single_glob` | B1 | S5 | any adapter with `pathRegex` scopes candidate set |
| 6  | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B1_single_glob_sqlite` | B1, Y3 | S5 | **real `better-sqlite3`**; `Daily/**` only |
| 7  | contract | `tests/contract/document-store.filters.contract.ts::B2_union_globs` | B2 | S6 | multiple globs unioned |
| 8  | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B2_union_globs_sqlite` | B2 | S6 | real SQLite; `Daily/**` ∪ `Journal/**` |
| 9  | contract | `tests/contract/document-store.filters.contract.ts::B3_dateRange_inclusive` | B3 | S7 | inclusive endpoints |
| 10 | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B3_dateRange_inclusive_sqlite` | B3 | S7 | real SQLite; `BETWEEN start AND end` |
| 11 | contract | `tests/contract/document-store.filters.contract.ts::B4_null_note_date_excluded` | B4, Y4 | S8 | `NULL note_date` excluded when `dateRange` present |
| 12 | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B4_null_note_date_excluded_sqlite` | B4, Y4 | S8 | real SQLite; binding evidence for Y4 |
| 13 | contract | `tests/contract/document-store.filters.contract.ts::B5_intersection` | B5 | S10 | `pathGlobs ∧ dateRange` |
| 14 | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B5_intersection_sqlite` | B5 | S10 | real SQLite |
| 15 | contract | `tests/contract/document-store.filters.contract.ts::B6_note_date_round_trip` | B6 | S9 | `upsertNoteMeta` / `getNoteMeta` honors `noteDate` |
| 16 | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B6_note_date_round_trip_sqlite` | B6 | S9 | real SQLite; column persistence |
| 17 | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::Y3_filters_pushed_down_all_paths` | Y3 | S5, S7, S8, S14 | **binding**; asserts predicates applied at summary + content + fallback ANN — pathGlob + dateRange + NULL exclusion |
| 18 | integration | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::Y5_note_date_populated_by_indexing` | Y5 | S9 | real SQLite; indexer populates `note_date` from fixture vault |
| 19 | unit | `tests/core/workflows/SearchWorkflow.filters.test.ts::C1_propagation_phase1_phase2` | C1 | S5, S7 | fake store spy; Phase 1 + Phase 2 both receive filter |
| 20 | unit | `tests/core/workflows/SearchWorkflow.filters.test.ts::C2_fallback_keeps_filters` | C2 | S14 | fallback `searchContentVectors` still carries user filters |
| 21 | unit | `tests/core/workflows/SearchWorkflow.filters.test.ts::C3_empty_after_filters_triggers_ie` | C3, Y7 | S12 | zero-result-after-filter → REQ-001 insufficient-evidence path |
| 22 | unit | `tests/core/workflows/ChatWorkflow.filters.test.ts::C4_forwards_filters` | C4 | S11, S14 | chat uses same shared retrieval helper; parity with search |
| 23 | ui | `tests/plugin/ui/ChatView.filters.test.ts::C5_chat_input_slash_commands` | C5 | S11 | `path:` + `last:14d` parsed into payload; stripped text |
| 24 | unit | `tests/core/domain/types.shape.test.ts::Y1_request_shape` | Y1 | S5, S7, S11 | static shape + runtime optional semantics |
| 25 | script | `scripts/check-boundaries.mjs(npm run check:boundaries)` | Y2 | — | forbids `sqlite` / `fs` / `node:*` imports in `src/core/domain/*` |
| 26 | contract | `tests/contract/document-store.filters.contract.ts(vitest)` suite entry | Y6 | S5, S6, S7, S8, S9, S10 | generic port-contract execution against `SqliteDocumentStore` |

Every REQ-004 RET-6-tagged `Sn` is covered:

- **S5** → rows 1, 5, 6, 17, 19, 24, 26
- **S6** → rows 1, 7, 8, 26
- **S7** → rows 9, 10, 17, 19, 24, 26
- **S8** → rows 11, 12, 17, 26
- **S9** → rows 2, 15, 16, 18, 26
- **S10** → rows 13, 14, 26
- **S11** → rows 3, 4, 22, 23, 24
- **S12** → row 21
- **S14** → rows 17, 20, 22

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Users write globs the parser can't handle (e.g. bracket expansion `{a,b}`). | `compilePathGlob` throws a descriptive error; `ChatView` shows inline warning; workflow proceeds unfiltered. Bracket expansion is called out as out-of-scope in Section 1. |
| 2 | Daily-note date patterns vary widely (`MM-DD-YYYY`, `YYYYMMDD`). | `dailyNoteDatePattern` is user-configurable; parser is pattern-driven, not hardcoded; supports `YYYY`, `MM`, `DD` per ADR-014 Decision 4. Other tokens are rejected with a clear error. |
| 3 | `note_date` stays NULL until the user reindexes after the STO-4 migration. | Documented in release notes and in the settings tab; a reindex prompt fires automatically after the migration completes. Any prior vector data continues to work; only `dateRange` queries are affected until the reindex lands. |
| 4 | Windows path-separator handling (`\` vs `/`) diverges across platforms. | Glob compiler normalizes all separators to `/` before matching; `notes.path` is stored with `/` separators by the indexer; tracked in REQ-004 §7 Open question. |
| 5 | Filter push-down bug on the content-only fallback call (the "unrestricted" path) silently drops user filters. | Integration test `Y3` explicitly asserts filters are applied to the fallback call; workflow test `C2` asserts the fallback `searchContentVectors` call carries the filter object; ADR-014 Decision 6 is restated as binding constraint Y3. |
| 6 | Chat/search divergence — one path applies filters and the other doesn't. | Both workflows route through the shared retrieval helper; `C4_forwards_filters` asserts chat and search receive identical filter objects. |

---

## Implementation Order

1. **Types first** — extend `src/core/domain/types.ts` with `SearchRequest` / `ChatWorkflowOptions` / `NodeFilter` / `NoteMeta` additions (covers Y1). Run `tsc --noEmit`; everything else depends on these shapes.
2. **Pure helpers** — create `src/core/domain/pathGlob.ts`, `dailyNoteDate.ts`, `chatInputParser.ts` with unit tests (covers A1, A2, A3, A4, Y2). These have no dependencies and unlock every downstream layer.
3. **Port contract test suite** — author `tests/contract/document-store.filters.contract.ts` red-first so the adapter changes are test-driven (covers B1–B6, Y6).
4. **`SqliteDocumentStore` adapter** — append SQL predicates for `pathLike` / `pathRegex` / `dateRange`; persist + read `note_date` in `note_meta`; wire filters into the content-only fallback call (covers B1–B6, Y3, Y4). Run the contract suite against it plus the dedicated integration tests with real `better-sqlite3`.
5. **Indexer wiring** — in `SidecarRuntime.ts`, call `parseDailyNoteDate` during indexing and set `noteDate` on the `NoteMeta` passed to `upsertNoteMeta` (covers Y5). Exercise end-to-end with the indexer fixture test.
6. **Workflow threading** — thread `pathGlobs` / `dateRange` through `SearchWorkflow` and `ChatWorkflow` into `NodeFilter` for Phase 1, Phase 2, and the fallback call (covers C1, C2, C3, C4, Y7).
7. **Transport + settings** — extend the sidecar `chat` / `search` payload schema in `httpServer.ts` / `stdioServer.ts`; add `dailyNotePathGlobs` / `dailyNoteDatePattern` to `SettingsTab`.
8. **Chat UI** — wire `parseChatInput` into `ChatView` submit handler; include parsed filters in the chat payload (covers C5).
9. **Verify** — `npm run build`, `npm run lint`, `npm run test`, `npm run check:boundaries` (covers Z1–Z5). Manual smoke: indexed fixture vault + chat query `path:Daily/** last:14d summarize my notes`.
10. **Final verify** — run `/review-story RET-6` and confirm zero `high`/`critical` `TEST-#` / `SEC-#` / `REL-#` / `API-#` findings (covers Z6).

---

*Created: 2026-04-20 | Story: RET-6 | Epic: 5 — Retrieval, search workflow, and chat workflow*
