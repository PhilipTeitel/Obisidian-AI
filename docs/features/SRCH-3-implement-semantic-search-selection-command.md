# SRCH-3: Implement `Semantic search selection` command

**Story**: Make the `Semantic search selection` command open the search pane, populate it with selected note text, and execute semantic search through the shared pane workflow.
**Epic**: Epic 4 — Semantic Search Experience
**Size**: Small
**Status**: Done

---

## 1. Summary

SRCH-3 turns the existing shell command into a functional semantic retrieval shortcut. Users should be able to highlight note text, run the command, and immediately see semantically related results in the search pane.

This story depends on SRCH-2 state orchestration and improves discoverability for semantic search by removing manual query copy/paste. It also lays groundwork for SRCH-4 navigation by ensuring command-triggered results enter the same pane and result-action pathway as manual searches.

The guiding constraint is behavior consistency: command-triggered searches must use the same request construction, status transitions, and error handling as pane-triggered searches.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No new shared schema types are required. The command consumes existing internal contracts:

```ts
type SearchSelectionCommand = () => Promise<void>;
type SearchExecution = (query: string) => Promise<SearchResult[]>;
```

If no selection is present, the command should short-circuit with user guidance and perform no search call.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Semantic search selection command
└── plugin.getActiveSelection()
    ├── activate SearchView
    └── SearchPaneModel.searchFromSelection(selection)
        └── SearchService.search()
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `registerCommands -> SEARCH_SELECTION` | async callback | Command lifecycle | Entry point for selection-driven semantic search |
| `getActiveSelection` | `() => string | null` | None | Normalizes and validates editor selection |
| `SearchPaneModel.searchFromSelection` | `(selection: string) => Promise<SearchResult[]>` | Shared pane state | Reuses pane search pipeline and updates query |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Search pane indicates command-triggered search is running |
| Error | Normalized error notice and pane error state |
| Empty | Missing selection notice or no-result status in pane |
| Success | Search pane displays selection-derived results |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/integration/searchSelectionCommand.integration.test.ts` | Focused integration checks for selection-command behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Replace placeholder selection-command implementation with real pane model execution |
| 2 | `src/ui/SearchPaneModel.ts` | Add selection entrypoint that updates query and executes search |
| 3 | `src/__tests__/integration/plugin.runtime.test.ts` | Update existing command expectations away from shell placeholder notice |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — command behavior should consume existing search contract without service changes.
- `src/ui/ChatView.ts` — no chat-pane impact.

---

## 5. Acceptance Criteria Checklist

### Phase A: Command Behavior

- [x] **A1** — Empty selection path is guarded with actionable notice
  - Command shows guidance notice and returns when no selected text exists.
  - No search request is executed for empty selection.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::A1_empty_selection_guard(vitest)`

- [x] **A2** — Populated selection activates search pane and sets selection text as query
  - Command ensures search pane is opened/revealed before execution.
  - Shared pane query state matches trimmed selected text.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::A2_selection_sets_query_and_reveals_search_view(vitest)`

- [x] **A3** — Selection command executes semantic search through shared pane model
  - Search execution path uses same model/request handling as pane searches.
  - Result rendering path is shared (no command-only duplicate rendering code).
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::A3_selection_uses_shared_search_pipeline(vitest)`

### Phase B: Error Handling + Compatibility

- [x] **B1** — Runtime errors from selection command are normalized and user-visible
  - Failures from search execution produce normalized notice messaging.
  - Plugin does not crash or leave command registration in bad state.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::B1_selection_failure_notice_path(vitest)`

- [x] **B2** — Existing plugin runtime integration tests remain green after command implementation
  - Command list and lifecycle behavior continue to satisfy integration coverage.
  - Placeholder-not-implemented notice is removed from expected paths.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::handles_semantic_search_selection_command_for_empty_and_populated_selections(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` consumer files in the SRCH-3 scope; no conflicting imports were introduced.
  - Evidence: `src/main.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Command might bypass pane controls and create inconsistent search behavior | Route command through `SearchPaneModel` rather than calling service directly |
| 2 | Selection retrieval can vary by editor context | Keep strict null/whitespace guard and deterministic trim logic |
| 3 | Excess notices can clutter UX | Emit notices only for actionable failures/guards and let pane carry normal state changes |

---

## Implementation Order

1. `src/ui/SearchPaneModel.ts` — add `searchFromSelection` helper that updates query and runs search pipeline (covers A2, A3).
2. `src/main.ts` — replace command placeholder with real selection flow (guard, activate view, run model search) (covers A1, A2, A3, B1).
3. `src/__tests__/integration/searchSelectionCommand.integration.test.ts` — add explicit command behavior tests (covers A1, A2, A3, B1).
4. `src/__tests__/integration/plugin.runtime.test.ts` — keep legacy runtime suite aligned with implemented behavior (covers B2).
5. **Verify** — run targeted integration tests for selection command.
6. **Final verify** — run `npm run lint && npm run build && npm run test`.

---

*Created: 2026-02-24 | Story: SRCH-3 | Epic: Epic 4 — Semantic Search Experience*
