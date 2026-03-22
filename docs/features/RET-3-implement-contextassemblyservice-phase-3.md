# RET-3: Implement ContextAssemblyService (Phase 3)

**Story**: Create `ContextAssemblyService` that takes Phase 2 leaf matches and assembles structured context blocks with heading trails, sibling content, and parent summaries, enforcing per-tier token budgets.
**Epic**: Epic 14 — Three-Phase Hierarchical Retrieval
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story delivers Phase 3 of the three-phase hierarchical retrieval strategy (R6, R7). The `ContextAssemblyService` takes `LeafMatch[]` from Phase 2 and assembles `AssembledContext` with structured `HierarchicalContextBlock[]` preserving document hierarchy.

For each matched leaf node, the service:
1. Walks UP the tree to collect the full heading trail (structural context)
2. Collects sibling nodes (surrounding context within the same section)
3. Collects parent summaries (broader context)
4. Applies separate configurable token budgets per tier:
   - **Matched content:** ~2000 tokens
   - **Sibling context:** ~1000 tokens
   - **Parent summaries:** ~1000 tokens
5. Tracks actual token usage per tier for observability

Key design decisions:
- **Per-tier budgets**: Each context tier has an independent token budget, configurable via settings.
- **Token estimation**: Uses the `estimateTokens` utility from HIER-4.
- **Truncation**: When content exceeds a tier budget, `truncateToTokenBudget` is applied.
- **Structured logging**: Emits `retrieval.phase3.completed` and `context.assembly.budget_usage` events.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. New service:

```ts
export interface ContextAssemblyServiceDeps {
  hierarchicalStore: HierarchicalStoreContract;
  getSettings: () => ObsidianAISettings;
}

export class ContextAssemblyService implements RuntimeServiceLifecycle {
  constructor(deps: ContextAssemblyServiceDeps);
  init(): Promise<void>;
  dispose(): Promise<void>;
  assemble(matches: LeafMatch[]): Promise<AssembledContext>;
}
```

---

## 3. Frontend Flow

No frontend components are created or modified. The service is consumed by `ChatService` (RET-5) and `SearchService`.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/ContextAssemblyService.ts` | Phase 3 context assembly service |
| 2 | `src/__tests__/unit/contextAssemblyService.test.ts` | Unit tests for context assembly |

### Files UNCHANGED

- `src/types.ts` — `LeafMatch`, `AssembledContext`, `HierarchicalContextBlock`, `ContextTierUsage` already defined
- `src/utils/tokenEstimator.ts` — consumed as-is
- `src/storage/SqliteVecRepository.ts` — `getAncestorChain`, `getSiblings`, `getSummary` already implemented

---

## 5. Acceptance Criteria Checklist

### Phase A: Service Structure

- [x] **A1** — `ContextAssemblyService` class exists and implements `RuntimeServiceLifecycle`
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::A1_lifecycle(vitest)`

- [x] **A2** — `ContextAssemblyService` accepts `ContextAssemblyServiceDeps` via constructor
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::A2_constructor_deps(vitest)`

### Phase B: Context Assembly Logic

- [x] **B1** — `assemble` collects heading trails from ancestor chains
  - Each `HierarchicalContextBlock` includes the full `headingTrail` from the leaf's ancestors.
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B1_heading_trails(vitest)`

- [x] **B2** — `assemble` collects sibling content
  - For each leaf, sibling nodes from the same parent are collected as `siblingContent`.
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B2_sibling_content(vitest)`

- [x] **B3** — `assemble` collects parent summaries
  - For each leaf, parent/ancestor summaries are collected as `parentSummary`.
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B3_parent_summaries(vitest)`

- [x] **B4** — `assemble` applies matched content token budget
  - Matched content is truncated to the configured `matchedContentBudget` (~2000 tokens).
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B4_matched_budget(vitest)`

- [x] **B5** — `assemble` applies sibling context token budget
  - Sibling content is truncated to the configured `siblingContextBudget` (~1000 tokens).
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B5_sibling_budget(vitest)`

- [x] **B6** — `assemble` applies parent summary token budget
  - Parent summaries are truncated to the configured `parentSummaryBudget` (~1000 tokens).
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B6_parent_budget(vitest)`

- [x] **B7** — `assemble` tracks actual token usage per tier
  - `AssembledContext.tierUsage` reports actual tokens used for matched, sibling, and parent tiers.
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::B7_tier_usage_tracking(vitest)`

### Phase C: Edge Cases

- [x] **C1** — Empty matches returns empty context
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::C1_empty_matches(vitest)`

- [x] **C2** — Disposed service throws
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::C2_disposed_throws(vitest)`

### Phase D: Structured Logging

- [x] **D1** — Emits `retrieval.phase3.completed` event
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::D1_phase3_completed(vitest)`

- [x] **D2** — Emits `context.assembly.budget_usage` event
  - Evidence: `src/__tests__/unit/contextAssemblyService.test.ts::D2_budget_usage_event(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes (or only pre-existing warnings)
- [x] **Z3** — No `any` types
- [x] **Z4** — All existing tests continue to pass

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Token budgets are approximate (chars/4 heuristic) | Sufficient for budget enforcement; exact counting not needed for context assembly |
| 2 | Many leaf matches could cause many store queries | Results are already limited by Phase 2 topK |

---

## Implementation Order

1. `src/services/ContextAssemblyService.ts` — Create class with deps, lifecycle, and `assemble` method
2. `src/__tests__/unit/contextAssemblyService.test.ts` — Write comprehensive tests
3. **Final verify** — `npm run test && npm run lint`

---

*Created: 2026-03-22 | Story: RET-3 | Epic: Epic 14 — Three-Phase Hierarchical Retrieval*
