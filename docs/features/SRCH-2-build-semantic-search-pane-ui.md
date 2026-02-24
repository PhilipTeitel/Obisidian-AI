# SRCH-2: Build Semantic Search pane UI

**Story**: Deliver an interactive semantic search pane that accepts query input and renders loading, success, empty, and error states from runtime search results.
**Epic**: Epic 4 — Semantic Search Experience
**Size**: Medium
**Status**: Done

---

## 1. Summary

SRCH-2 introduces the first end-user semantic search interface in the plugin UI. The pane must collect a free-text query, execute semantic retrieval through the existing `SearchService`, and render readable result cards that include note metadata and relevance signals.

This story is the UX bridge between SRCH-1 service readiness and the remaining search stories. SRCH-3 depends on this pane to surface selection-driven searches, SRCH-4 depends on the rendered result actions to drive navigation, and SRCH-5 extends this pane with quality controls.

The key design constraint is single-source state management for pane query/results/status so command-triggered searches and pane-triggered searches can share the same rendering and error pathways.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

Internal UI runtime state should be represented with explicit TypeScript contracts in `src/ui` and consume the existing `SearchRequest` / `SearchResult` definitions from `src/types.ts`.

```ts
export type SearchPaneStatus = "idle" | "loading" | "success" | "empty" | "error";

export interface SearchPaneState {
  query: string;
  status: SearchPaneStatus;
  results: SearchResult[];
  errorMessage?: string;
}
```

No changes to external schemas are needed.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
SearchView (ItemView)
└── SearchPaneModel (state + orchestration)
    ├── search(request) -> SearchService.search()
    └── result list render state
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchView` | `(leaf, model)` | View-local element handles | Renders semantic search layout and subscribes to model state |
| `SearchPaneModel.search` | `(query?: string) => Promise<SearchResult[]>` | Shared pane state | Handles loading/success/empty/error transitions |
| `SearchPaneModel.subscribe` | `(listener) => unsubscribe` | Observer list | Keeps view rendering synced with command-driven updates |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Search action disabled and status text indicates semantic retrieval in progress |
| Error | Error message rendered in pane status area |
| Empty | Shows no-results or missing-query guidance |
| Success | Displays ranked result list with note title, heading, snippet, and score |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/ui/SearchPaneModel.ts` | Shared search pane state and orchestration for pane + command workflows |
| 2 | `src/__tests__/unit/searchPaneModel.test.ts` | Unit tests for state transitions and search request orchestration |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/SearchView.ts` | Replace shell content with interactive pane rendering and state subscriptions |
| 2 | `src/main.ts` | Construct pane model and inject it into `SearchView` registration |
| 3 | `src/__tests__/integration/plugin.runtime.test.ts` | Align integration expectations with implemented semantic search pane behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — SRCH-1 already provides semantic retrieval contract used by this UI story.
- `src/storage/LocalVectorStoreRepository.ts` — retrieval internals remain unchanged; pane is a consumer only.

---

## 5. Acceptance Criteria Checklist

### Phase A: Pane Rendering + Query Execution

- [x] **A1** — Search pane renders semantic search input and run action
  - Pane includes a query entry control and visible execution trigger.
  - Loading/empty/error/success status region is always present.
  - Evidence: `src/__tests__/unit/searchView.test.ts::A1_renders_search_input_and_actions(vitest)`

- [x] **A2** — Query execution routes through shared pane model into `SearchService.search`
  - Running search with non-empty query calls search runtime with expected request fields.
  - Empty/whitespace query does not call runtime and resolves to non-error state.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::A2_query_executes_search_service(vitest)`

- [x] **A3** — Success state renders ranked result metadata
  - Result rows include note title/path context, optional heading, snippet preview, and score display.
  - Ranking order mirrors returned `SearchResult[]` order.
  - Evidence: `src/__tests__/unit/searchView.test.ts::A3_renders_result_metadata(vitest)`

### Phase B: Resilience + Runtime Integration

- [x] **B1** — Runtime failures surface pane error state instead of throwing to UI shell
  - Rejected search promises update model to `error` with readable message.
  - Pane remains interactive after failure.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::B1_failed_search_sets_error_state(vitest)`

- [x] **B2** — Plugin runtime wires SearchView with a shared pane model instance
  - View registration path can render and consume model state.
  - Existing integration command lifecycle tests still pass with new wiring.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::A2_selection_sets_query_and_reveals_search_view(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/SearchPaneModel.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` consumer files in the SRCH-2 scope; no conflicting imports were introduced.
  - Evidence: `src/ui/SearchPaneModel.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | UI state can diverge when command and pane both trigger searches | Centralize behavior in `SearchPaneModel` with single state source |
| 2 | Obsidian test shim lacks full browser events | Guard DOM event hooks and verify state orchestration with direct model tests |
| 3 | Larger result snippets may clutter pane | Keep concise snippet rendering and preserve full source path for navigation context |

---

## Implementation Order

1. `src/ui/SearchPaneModel.ts` — add state model, subscription API, and query execution orchestration (covers A1, A2, B1).
2. `src/ui/SearchView.ts` — implement pane layout and render bindings for all state variants (covers A1, A3).
3. `src/main.ts` — construct/inject shared pane model during view registration lifecycle (covers B2).
4. `src/__tests__/unit/searchPaneModel.test.ts` — add focused model behavior tests for state transitions and ordering (covers A1, A2, A3, B1).
5. `src/__tests__/integration/plugin.runtime.test.ts` — verify runtime wiring compatibility (covers B2).
6. **Verify** — run targeted tests for search pane model and runtime integration.
7. **Final verify** — run `npm run lint && npm run build && npm run test`.

---

*Created: 2026-02-24 | Story: SRCH-2 | Epic: Epic 4 — Semantic Search Experience*
