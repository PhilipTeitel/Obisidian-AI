# LOG-2: Instrument SearchService and SearchPaneModel with structured logging

**Story**: Add structured, operation-scoped logging to search service and search UI model so query lifecycle timing and failures are observable.
**Epic**: Epic 9 — Logging and Observability Instrumentation
**Size**: Medium
**Status**: Done

---

## 1. Summary

LOG-2 adds first-class observability for semantic search. It instruments `SearchService` and `SearchPaneModel` so each search operation emits consistent lifecycle events with timing and outcome metadata.

This story depends on LOG-1 logger capabilities (`withOperation`, level helpers) and validates that operational telemetry can be applied without changing search behavior.

The key design principle is low-overhead diagnostics: logs should provide enough context (query length, topK, minScore, timings, counts) to debug runtime issues while avoiding sensitive payload logging.

---

## 2. API Endpoints + Schemas

No API endpoint changes are required.

No shared schema changes are required. Existing runtime log contracts from LOG-1 are used as-is.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
SearchPaneModel.search()
└── SearchService.search()
    ├── embeddingService.embed()
    ├── vectorStoreRepository.queryNearestNeighbors()
    └── mapped SearchResult[]
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchService.search` | `(request: SearchRequest) => Promise<SearchResult[]>` | Runtime service lifecycle | Emits start/embedding/vector/complete/failure events |
| `SearchPaneModel.search` | `(queryInput?: string) => Promise<SearchResult[]>` | View-model UI state | Emits search start/success/empty/error events |
| `SearchPaneModel.openResult` | `(result: SearchResult) => Promise<void>` | Result interaction | Emits navigation success/failure events |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Search status is `loading` while lifecycle logs emit start/timing. |
| Error | Search status is `error`; logs include normalized error domain/context. |
| Empty | Search status is `empty`; logs include zero-result completion metadata. |
| Success | Search status is `success`; logs include result count and elapsed timings. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/LOG-2-instrument-searchservice-and-searchpanemodel-with-structured-logging.md` | Story spec and acceptance criteria |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/SearchService.ts` | Add structured query lifecycle logs with embedding/vector timing |
| 2 | `src/ui/SearchPaneModel.ts` | Add structured UI lifecycle logs for search/open-result operations |
| 3 | `src/__tests__/unit/searchService.test.ts` | Extend tests to cover logging paths and unchanged behavior |
| 4 | `src/__tests__/unit/searchPaneModel.test.ts` | Extend tests to cover pane model logging-safe outcomes |
| 5 | `README.md` | Link LOG-2 story and mark status done after completion |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — display behavior unchanged; model instrumentation only.
- `src/storage/LocalVectorStoreRepository.ts` — storage instrumentation is deferred to LOG-5.

---

## 5. Acceptance Criteria Checklist

### Phase A: SearchService Lifecycle Logging

- [x] **A1** — SearchService logs query start with operation metadata
  - Includes query length, topK, and minScore context.
  - Evidence: `src/services/SearchService.ts::A1_query_start_logging(code-review)`

- [x] **A2** — SearchService logs embedding and vector query timing with result count
  - Emits elapsed milliseconds for embedding and vector search stages.
  - Evidence: `src/services/SearchService.ts::A2_embedding_and_vector_timing(code-review)`

- [x] **A3** — SearchService logs completion and failure outcomes
  - Completion includes result count; failures include normalized error details.
  - Evidence: `src/__tests__/unit/searchService.test.ts::B2_normalizes_dependency_failures(vitest)`

### Phase B: SearchPaneModel Lifecycle Logging

- [x] **B1** — SearchPaneModel logs query lifecycle across empty/success/error outcomes
  - Emits operation-scoped start and completion/failure events without changing state transitions.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::B1_failed_search_sets_error_state(vitest)`

- [x] **B2** — SearchPaneModel logs result-open success/failure interactions
  - Emits navigation intent and outcome metadata for selected search results.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::B1_open_result_failure_is_reported(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/SearchService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope does not add shared-client imports.
  - Evidence: `src/ui/SearchPaneModel.ts::Z4_import_path_consistency(eslint)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Search lifecycle operations are logged with context and timings.
  - Evidence: `src/services/SearchService.ts::Z5_search_lifecycle_logging(code-review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Over-logging could add noise in frequent search interactions | Keep debug/detail fields concise and rely on configurable log level |
| 2 | Timing capture can drift if measured inconsistently | Use `Date.now()` checkpoints around each stage |
| 3 | Query text logging may leak sensitive content | Log query length and metadata only, not full query text |

---

## Implementation Order

1. `src/services/SearchService.ts` — add operation-scoped lifecycle/timing logging around embedding + vector query + completion/failure (covers A1, A2, A3).
2. `src/ui/SearchPaneModel.ts` — add pane lifecycle and result-navigation logs for empty/success/error flows (covers B1, B2).
3. `src/__tests__/unit/searchService.test.ts` and `src/__tests__/unit/searchPaneModel.test.ts` — verify behavior remains correct with instrumentation in place.
4. **Verify** — run targeted search service/model tests.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-26 | Story: LOG-2 | Epic: Epic 9 — Logging and Observability Instrumentation*
