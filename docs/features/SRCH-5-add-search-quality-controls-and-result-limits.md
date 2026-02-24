# SRCH-5: Add search quality controls and result limits

**Story**: Add semantic search quality controls (top-k and relevance threshold) with sane defaults and guardrails to improve precision/recall tradeoffs.
**Epic**: Epic 4 — Semantic Search Experience
**Size**: Small
**Status**: Done

---

## 1. Summary

SRCH-5 introduces configurable retrieval controls in the semantic search experience so users can tune the number of results and minimum relevance accepted by the pane. This improves practical usability across different note densities and query specificity levels.

The story builds directly on SRCH-2 pane orchestration and SRCH-3 command reuse. Controls must affect both manual pane searches and selection-command searches so users get consistent retrieval quality regardless of entry path.

The design constraint is bounded configurability: expose enough control for quality tuning while preventing invalid/extreme values that degrade retrieval performance or overwhelm UI rendering.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No shared external schema changes are required, but local pane control contracts should be explicit:

```ts
export interface SearchQualityControls {
  topK: number;
  minScore?: number;
}
```

Search requests must always be formed with bounded control values before calling `SearchService.search`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
SearchView controls (topK, minScore)
└── SearchPaneModel.setTopK / setMinScore
    ├── clamp + normalize controls
    └── run search -> SearchService.search({ query, topK, minScore })
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchPaneModel` controls | `setTopK(value)`, `setMinScore(value?)` | Shared pane control state | Enforces sane bounds and normalized numeric values |
| `SearchView` control inputs | top-k + min-score UI elements | View-local element handles | Reflect model control state and update model on change |
| `SearchPaneModel.searchFromSelection` | `(selection: string) => Promise<SearchResult[]>` | Shared state | Must reuse current control values |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Uses currently configured bounded controls for in-flight request |
| Error | Invalid user control values are normalized before request; runtime errors still show error state |
| Empty | No matches after threshold filtering shows explicit empty state |
| Success | Result count and quality reflect current controls |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/searchQualityControls.test.ts` | Unit tests for control clamping/normalization behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/SearchPaneModel.ts` | Add top-k/min-score defaults, bounds, and normalized request composition |
| 2 | `src/ui/SearchView.ts` | Render control UI and bind updates to model |
| 3 | `src/main.ts` | Ensure selection command reuses model-level controls |
| 4 | `src/__tests__/integration/searchSelectionCommand.integration.test.ts` | Verify selection command respects active control values |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — already accepts `topK` and optional `minScore`; SRCH-5 is caller-side control wiring.
- `src/settings.ts` — control persistence in plugin settings is out of scope for this MVP story.

---

## 5. Acceptance Criteria Checklist

### Phase A: Controls + Defaults

- [x] **A1** — Search pane exposes top-k and relevance-threshold controls with sane defaults
  - Default values are applied when pane initializes.
  - Controls are visible and editable in search pane UI.
  - Evidence: `src/__tests__/unit/searchQualityControls.test.ts::A1_default_control_values(vitest)`

- [x] **A2** — Control values are clamped/normalized before request execution
  - `topK` is bounded to configured minimum and maximum.
  - `minScore` is optional and bounded to valid score range.
  - Evidence: `src/__tests__/unit/searchQualityControls.test.ts::A2_clamps_invalid_control_values(vitest)`

- [x] **A3** — Manual pane searches send bounded controls in `SearchRequest`
  - Search requests include normalized `topK` and optional `minScore`.
  - Evidence: `src/__tests__/unit/searchPaneModel.test.ts::A3_request_includes_normalized_controls(vitest)`

### Phase B: Cross-Entry Consistency

- [x] **B1** — Selection command searches reuse active pane control values
  - Running command search with existing controls sends same bounded values as manual pane searches.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::B1_selection_reuses_quality_controls(vitest)`

- [x] **B2** — Control changes persist for subsequent searches during runtime session
  - After control update, later searches use updated values until changed again.
  - Evidence: `src/__tests__/unit/searchQualityControls.test.ts::B2_control_updates_affect_subsequent_searches(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/unit/searchQualityControls.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` consumer files in the SRCH-5 scope; no conflicting imports were introduced.
  - Evidence: `src/ui/SearchPaneModel.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | User-entered control values may be invalid/non-numeric | Centralize normalization and fallback defaults in model layer |
| 2 | High `topK` can hurt responsiveness on larger vaults | Enforce conservative upper bound and keep defaults moderate |
| 3 | Strict thresholds can lead to confusing empty results | Show explicit empty-state messaging that references threshold behavior |

---

## Implementation Order

1. `src/ui/SearchPaneModel.ts` — add quality control defaults, bounds, and request normalization helpers (covers A1, A2, A3, B2).
2. `src/ui/SearchView.ts` — render top-k/min-score controls and sync them with model state (covers A1).
3. `src/main.ts` and selection-command path — ensure command-initiated searches use model controls (covers B1).
4. `src/__tests__/unit/searchQualityControls.test.ts` and `src/__tests__/unit/searchPaneModel.test.ts` — verify defaults, clamping, and request composition (covers A1, A2, A3, B2).
5. `src/__tests__/integration/searchSelectionCommand.integration.test.ts` — verify selection-command control reuse (covers B1).
6. **Verify** — run targeted quality-control and selection-command tests.
7. **Final verify** — run `npm run lint && npm run build && npm run test`.

---

*Created: 2026-02-24 | Story: SRCH-5 | Epic: Epic 4 — Semantic Search Experience*
