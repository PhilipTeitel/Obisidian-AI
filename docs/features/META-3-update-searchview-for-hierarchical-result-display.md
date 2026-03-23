# META-3: Update SearchView for hierarchical result display

**Story**: Update the SearchView and SearchPaneModel to display hierarchical search results with heading trail, parent summary context, and surrounding sibling content in search result cards.
**Epic**: Epic 16 — Scoped Tags, Cross-References, and Search UX Updates
**Size**: Medium
**Status**: Complete

---

## 1. Summary

The current `SearchPaneModel` uses the flat `SearchResult` type which has `chunkId`, `heading` (single string), and `snippet`. The `HierarchicalSearchResult` type already exists in `src/types.ts` with richer fields: `headingTrail` (full trail), `parentSummary`, `siblingSnippet`, and `matchedContent`.

This story updates the search pane to display hierarchical results:

1. **SearchPaneModel**: Update `SearchPaneState.results` to use `HierarchicalSearchResult[]` instead of `SearchResult[]`. Update the `runSearch` dependency to return `HierarchicalSearchResult[]`. Add an adapter that converts the existing `SearchService.search()` flat results into `HierarchicalSearchResult` format (for backward compatibility), or wire the model to use the hierarchical search pipeline (Phase 1 → Phase 2 → Phase 3).
2. **SearchView**: Update the result rendering to show heading trail (breadcrumb), parent summary (muted context), matched content (primary), sibling snippet (secondary context), and score badge.
3. **Wiring**: Update `main.ts` to wire the search pane model to use the hierarchical search pipeline when the hierarchical store is available.

The approach is to keep the flat search as a fallback and add hierarchical search as the primary path when the hierarchical store is initialized.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes.

The `SearchPaneState` in `SearchPaneModel.ts` changes its `results` type:

```ts
export interface SearchPaneState {
  query: string;
  status: SearchPaneStatus;
  results: HierarchicalSearchResult[];  // was SearchResult[]
  controls: SearchQualityControls;
  errorMessage?: string;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
SearchView (modified)
├── renderState()
│   └── For each HierarchicalSearchResult:
│       ├── Heading trail (breadcrumb: "Note > Topic > Subtopic")
│       ├── Note title (clickable link)
│       ├── File path (muted)
│       ├── Parent summary (muted, italic)
│       ├── Matched content (primary snippet)
│       ├── Sibling snippet (secondary, muted)
│       └── Score badge
```

### 3b. States

| State   | UI Behavior |
|---------|-------------|
| Loading | "Searching semantic index..." (unchanged) |
| Error   | Error message (unchanged) |
| Empty   | "No semantic matches found" (unchanged) |
| Success | Hierarchical result cards with heading trail, summary, content, siblings, score |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/hierarchicalSearchView.test.ts` | Unit tests for SearchPaneModel with HierarchicalSearchResult and SearchView rendering |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/SearchPaneModel.ts` | Change `results` type from `SearchResult[]` to `HierarchicalSearchResult[]`. Update `runSearch` dep type. Update `openResult` to accept `HierarchicalSearchResult`. |
| 2 | `src/ui/SearchView.ts` | Update `renderState` to display heading trail, parent summary, matched content, sibling snippet, and score for each `HierarchicalSearchResult`. |
| 3 | `src/main.ts` | Update search pane model wiring to produce `HierarchicalSearchResult[]` from the flat `SearchService.search()` results (adapt flat results to hierarchical format). |

### Files UNCHANGED

- `src/types.ts` — `HierarchicalSearchResult` already exists
- `src/services/SearchService.ts` — no changes; the adapter is in main.ts
- `src/services/ContextAssemblyService.ts` — no changes
- `src/settings.ts` — no settings changes

---

## 5. Acceptance Criteria Checklist

### Phase A: Model Update

- [x] **A1** — `SearchPaneState.results` uses `HierarchicalSearchResult[]` type
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::A1_results_type(vitest)`

- [x] **A2** — `SearchPaneModel.search()` returns `HierarchicalSearchResult[]`
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::A2_search_returns_hierarchical(vitest)`

- [x] **A3** — `SearchPaneModel.openResult()` accepts `HierarchicalSearchResult`
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::A3_open_result_hierarchical(vitest)`

### Phase B: View Rendering

- [x] **B1** — Search result cards display heading trail as breadcrumb
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::B1_heading_trail(vitest)`

- [x] **B2** — Search result cards display parent summary context
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::B2_parent_summary(vitest)`

- [x] **B3** — Search result cards display matched content as primary snippet
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::B3_matched_content(vitest)`

- [x] **B4** — Search result cards display score badge
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::B4_score_badge(vitest)`

### Phase C: Wiring

- [x] **C1** — `main.ts` wires search pane model to produce `HierarchicalSearchResult[]`
  - The `runSearch` callback in `main.ts` converts flat `SearchResult[]` to `HierarchicalSearchResult[]` format.
  - Evidence: `src/__tests__/unit/hierarchicalSearchView.test.ts::C1_adapter(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (no regressions)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Changing `SearchPaneState.results` type breaks existing tests that construct `SearchResult` objects | Update test mocks to use `HierarchicalSearchResult` format. The adapter in main.ts ensures backward compatibility with the flat search service. |
| 2 | The flat-to-hierarchical adapter loses some information (no real parent summary or sibling content from flat search) | The adapter fills `parentSummary` and `siblingSnippet` with empty strings. When the full hierarchical pipeline is used in the future, these fields will be populated. |
| 3 | Changing the `openResult` callback signature may break existing wiring | The `HierarchicalSearchResult` includes `notePath` and `headingTrail`, which provide the same navigation info as the flat `SearchResult.notePath` and `SearchResult.heading`. |

---

## Implementation Order

1. `src/ui/SearchPaneModel.ts` — Update types to use `HierarchicalSearchResult` (covers A1–A3)
2. `src/ui/SearchView.ts` — Update rendering for hierarchical results (covers B1–B4)
3. `src/main.ts` — Update wiring with flat-to-hierarchical adapter (covers C1)
4. **Verify** — `npm run typecheck && npm run build`
5. Fix any broken existing tests due to type changes
6. `src/__tests__/unit/hierarchicalSearchView.test.ts` — Write tests for all acceptance criteria
7. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: META-3 | Epic: Epic 16 — Scoped Tags, Cross-References, and Search UX Updates*
