# REL-2: Run scale validation for indexing and search latency

**Story**: Add repeatable scale validation coverage that measures indexing and search latency on vault-sized note sets from hundreds to thousands of notes.
**Epic**: Epic 7 — Performance, Reliability, and MVP Readiness
**Size**: Medium
**Status**: Done

---

## 1. Summary

REL-2 creates a repeatable performance-validation harness for MVP readiness. The project already has strong correctness tests for indexing/search, but it does not yet provide explicit latency evidence on larger synthetic vault sizes. This story introduces automated scale checks to validate practical performance envelopes before release.

The scope is benchmark-style integration testing against realistic indexing and retrieval flows: full reindex, incremental index changes, and semantic search on generated vault data sets. The goal is not micro-optimization in this story; it is to establish an objective baseline and guardrail thresholds that catch major regressions.

The main design constraint is stability over strictness. Performance assertions must be generous enough for CI/dev machine variability while still meaningful enough to detect severe degradations.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required.

REL-2 adds test/docs/script coverage only; runtime contracts in `src/types.ts` remain unchanged.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Scale validation test
└── Plugin test harness
    ├── lazy runtime bootstrap
    ├── IndexingService.reindexVault()
    ├── IndexingService.indexChanges()
    └── SearchService.search()
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `scaleValidation.integration.test.ts` | synthetic note counts + latency budgets | per-scenario metrics | Produces repeatable evidence for hundreds/thousands-note workloads |
| `npm run test:scale` | `vitest run <scale test>` | pass/fail + timing logs | Dedicated command to re-run scale validation on demand |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Long-running validation test executes indexing/search workloads |
| Error   | Budget breach or runtime failure fails test with scenario-specific metric context |
| Empty   | N/A (this story is test/docs only) |
| Success | All scenarios remain under configured practical latency thresholds |

Frontend component implementation is not applicable for REL-2.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/REL-2-run-scale-validation-for-indexing-and-search-latency.md` | REL-2 story plan and checklist |
| 2 | `src/__tests__/integration/scaleValidation.integration.test.ts` | Repeatable scale validation scenarios and latency assertions |
| 3 | `docs/runbooks/scale-validation.md` | Operator-facing instructions and baseline metric capture for scale validation runs |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `package.json` | Add dedicated `test:scale` script for quick scale validation reruns |
| 2 | `README.md` | Link REL-2 story and document new scale-validation command |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/IndexingService.ts` — REL-2 validates current behavior rather than changing indexing algorithms.
- `src/services/SearchService.ts` — search implementation remains unchanged; only measured under larger datasets.

---

## 5. Acceptance Criteria Checklist

### Phase A: Scale Validation Coverage

- [x] **A1** — Add repeatable synthetic vault scenarios covering both hundreds and thousands of notes
  - Include at least one scenario in the hundreds range and one in the thousands range.
  - Evidence: `src/__tests__/integration/scaleValidation.integration.test.ts::validates_indexing_search_latency_budgets_for_hundreds_scenario(vitest)`

- [x] **A2** — Validate full reindex and semantic search latency budgets per scenario
  - Each scenario captures elapsed time and asserts practical upper bounds.
  - Evidence: `src/__tests__/integration/scaleValidation.integration.test.ts::validates_indexing_search_latency_budgets_for_thousands_scenario(vitest)`

- [x] **A3** — Validate incremental indexing latency after note updates in large scenario
  - At least one scenario mutates previously indexed notes and measures `indexChanges`.
  - Evidence: `src/__tests__/integration/scaleValidation.integration.test.ts::validates_indexing_search_latency_budgets_for_thousands_scenario(vitest)`

### Phase B: Developer Workflow + Baseline Reporting

- [x] **B1** — Add dedicated script to run scale validation independently
  - `npm run test:scale` executes only REL-2 scale validation tests.
  - Evidence: `package.json::B1_test_scale_script(npm run test:scale)`

- [x] **B2** — Document how to run and interpret scale validation results
  - Include run command, thresholds, and baseline notes in project documentation.
  - Evidence: `docs/runbooks/scale-validation.md::B2_scale_runbook(md)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/integration/scaleValidation.integration.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` package; REL-2 introduces no import changes that violate this guardrail.
  - Evidence: `src/__tests__/integration/scaleValidation.integration.test.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Performance tests can be flaky across machines | Use realistic but generous budget thresholds and deterministic synthetic fixtures |
| 2 | Synthetic notes may not represent every real-vault shape | Cover multiple sizes and include mixed-note updates for incremental indexing |
| 3 | Long-running tests can slow local workflow | Provide dedicated `test:scale` command so routine test runs remain focused |

---

## Implementation Order

1. `src/__tests__/integration/scaleValidation.integration.test.ts` — add synthetic datasets, timing helpers, and latency assertions for reindex/search/index-changes scenarios (covers A1, A2, A3).
2. `package.json` — add `test:scale` command for isolated reruns (covers B1).
3. `docs/runbooks/scale-validation.md` — document execution steps, budgets, and baseline interpretation (covers B2).
4. `README.md` — add REL-2 link and surface new `test:scale` script in available scripts table (covers B1, B2).
5. **Verify** — run `npm run test:scale` and capture metrics from test output.
6. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: REL-2 | Epic: Epic 7 — Performance, Reliability, and MVP Readiness*
