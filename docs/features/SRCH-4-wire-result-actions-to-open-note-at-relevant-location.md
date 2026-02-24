# SRCH-4: Wire result actions to open note at relevant location

**Story**: Enable result actions in the semantic search pane that open the target note and preserve heading context for the matched chunk.
**Epic**: Epic 4 — Semantic Search Experience
**Size**: Small
**Status**: Done

---

## 1. Summary

SRCH-4 converts semantic results from passive information into actionable navigation. Users should be able to select a result and jump directly to the matched note location, with heading context retained whenever available.

This story depends on SRCH-2 result rendering and SRCH-3 shared pane workflow. It completes the main value loop for search by taking users from retrieval to source note inspection in one action.

The key design constraint is resilient navigation target construction: generated links must preserve heading context but still degrade safely when heading metadata is absent or navigation APIs are unavailable.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No shared schema changes are required. Navigation uses existing `SearchResult` shape and a local helper for target generation:

```ts
export const buildSearchResultLink = (result: Pick<SearchResult, "notePath" | "heading">): string => {
  return result.heading ? `${result.notePath}#${result.heading}` : result.notePath;
};
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
SearchView result row action
└── SearchPaneModel.openResult(result)
    └── plugin.openSearchResult(result)
        ├── buildSearchResultLink(result)
        └── workspace.openLinkText(...)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchView` result action | `(result) => Promise<void>` | None | Invoked from each rendered result card/button |
| `SearchPaneModel.openResult` | `(result: SearchResult) => Promise<void>` | Shared pane state | Delegates navigation to runtime callback and handles surfaced errors |
| `buildSearchResultLink` | `(notePath, heading?) => string` | Pure | Preserves heading context in generated destination |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Search state unchanged during navigation trigger; action remains quick |
| Error | Navigation failure emits user notice and keeps results visible |
| Empty | No actions rendered when result list is empty |
| Success | Clicking a result opens the target note/path (with heading anchor when available) |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/ui/searchNavigation.ts` | Pure helper utilities for result-link construction |
| 2 | `src/__tests__/unit/searchNavigation.test.ts` | Unit tests for note/heading navigation target generation |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Add runtime callback that opens semantic result links in workspace |
| 2 | `src/ui/SearchPaneModel.ts` | Add result action handler and callback plumbing |
| 3 | `src/ui/SearchView.ts` | Render clickable result actions wired to model navigation |
| 4 | `src/__tests__/harness/createMockAppHarness.ts` | Add navigation call recording surface for integration assertions |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — result retrieval remains unchanged; story focuses on result action behavior.
- `src/providers/**` — provider stack is not part of navigation flow.

---

## 5. Acceptance Criteria Checklist

### Phase A: Result Action Wiring

- [x] **A1** — Rendered search results expose user-triggered action handlers
  - Each success-state result provides an actionable control for navigation.
  - Action callback receives the corresponding `SearchResult`.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::A1_open_result_delegates_to_runtime(vitest)`

- [x] **A2** — Navigation target preserves heading context when available
  - Result with heading builds `notePath#heading` target.
  - Result without heading builds `notePath` target.
  - Evidence: `src/__tests__/unit/searchNavigation.test.ts::A2_builds_heading_aware_targets(vitest)`

- [x] **A3** — Runtime navigation callback opens link target through workspace
  - Plugin callback uses workspace navigation API with generated target.
  - Target passed to workspace matches helper output.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::A3_runtime_open_link_invocation(vitest)`

### Phase B: Failure Handling

- [x] **B1** — Navigation failures surface user-visible guidance without losing results
  - Errors from runtime navigation callback emit notice path.
  - Pane remains in success state with existing result list.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::B1_open_result_failure_is_reported(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/searchNavigation.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` consumer files in the SRCH-4 scope; no conflicting imports were introduced.
  - Evidence: `src/ui/searchNavigation.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Heading text may contain characters that require escaping | Keep helper isolated and covered by tests for representative heading input |
| 2 | Workspace API differences across Obsidian versions | Use feature-detected callback wiring and deterministic fallback notices |
| 3 | Navigation failure could clear user context | Do not mutate result state on navigation errors |

---

## Implementation Order

1. `src/ui/searchNavigation.ts` — implement link-target helper and heading handling (covers A2).
2. `src/main.ts` — add result-open runtime callback using workspace navigation API (covers A3).
3. `src/ui/SearchPaneModel.ts` and `src/ui/SearchView.ts` — wire result actions into model + UI render path (covers A1, B1).
4. `src/__tests__/unit/searchNavigation.test.ts` and `src/__tests__/unit/searchPaneModel.test.ts` — add behavior tests for navigation target and failure handling (covers A1, A2, B1).
5. `src/__tests__/harness/createMockAppHarness.ts` and integration tests — verify runtime callback invocations (covers A3).
6. **Verify** — run targeted search navigation/pane test files.
7. **Final verify** — run `npm run lint && npm run build && npm run test`.

---

*Created: 2026-02-24 | Story: SRCH-4 | Epic: Epic 4 — Semantic Search Experience*
