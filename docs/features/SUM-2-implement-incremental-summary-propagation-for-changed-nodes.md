# SUM-2: Implement incremental summary propagation for changed nodes

**Story**: Add staleness detection and incremental summary propagation to `SummaryService` so that when a node's content changes, summaries are regenerated from the changed node up through all ancestors to the note root.
**Epic**: Epic 13 — LLM Summary Generation Service
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story extends the `SummaryService` (from SUM-1) with incremental summary propagation capabilities. When a note's content changes during incremental indexing, only the affected nodes and their ancestors need summary regeneration — not the entire tree.

The key mechanism is **staleness detection**: a summary is stale when `node_summaries.generatedAt < nodes.updatedAt`. The `SummaryService` gains a new method `propagateSummariesForChangedNodes` that accepts a list of changed node IDs, detects which nodes have stale summaries, and regenerates summaries from each changed node up through all ancestors to the note root. This avoids redundant LLM calls for unchanged subtrees.

The `regenerateFromNode` method (already implemented in SUM-1) handles the per-node propagation. SUM-2 adds the orchestration layer that identifies stale nodes and deduplicates ancestor chains when multiple nodes in the same subtree have changed.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

New method added to `SummaryService`:

```ts
export interface StaleSummaryInfo {
  nodeId: string;
  nodeUpdatedAt: number;
  summaryGeneratedAt: number | null;
}

export class SummaryService {
  // ... existing methods from SUM-1 ...

  detectStaleSummaries(nodes: DocumentNode[]): Promise<StaleSummaryInfo[]>;
  propagateSummariesForChangedNodes(changedNodeIds: string[]): Promise<SummaryGenerationResult[]>;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created or modified. The service is consumed by the indexing pipeline:

```
src/services/SummaryService.ts (modified)
├── INTG-3: IndexingService calls propagateSummariesForChangedNodes() during incremental index
└── Uses:
    ├── HierarchicalStoreContract.getNode() for node lookup
    ├── HierarchicalStoreContract.getSummary() for staleness check
    ├── HierarchicalStoreContract.getAncestorChain() for propagation path
    └── regenerateFromNode() (from SUM-1) for per-node propagation
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `detectStaleSummaries` | `(nodes: DocumentNode[]) => Promise<StaleSummaryInfo[]>` | Stateless per call | Returns nodes whose summary is stale or missing |
| `propagateSummariesForChangedNodes` | `(changedNodeIds: string[]) => Promise<SummaryGenerationResult[]>` | Stateless per call | Orchestrates regeneration for all changed nodes with deduplication |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable |
| Error   | Individual node failures logged and skipped (same as SUM-1) |
| Empty   | No changed nodes returns empty results |
| Success | All stale summaries regenerated from changed nodes to root |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/summaryService.incremental.test.ts` | Unit tests for staleness detection and incremental propagation |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/SummaryService.ts` | Add `StaleSummaryInfo` interface, `detectStaleSummaries`, and `propagateSummariesForChangedNodes` methods |

### Files UNCHANGED

- `src/types.ts` — no new shared types needed
- `src/bootstrap/bootstrapRuntimeServices.ts` — wiring happens in INTG-1
- `src/services/IndexingService.ts` — integration happens in INTG-3

---

## 5. Acceptance Criteria Checklist

### Phase A: Staleness Detection

- [x] **A1** — `detectStaleSummaries` identifies nodes with no summary
  - A node that has never been summarized (no `SummaryRecord` in store) is reported as stale with `summaryGeneratedAt: null`.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::A1_no_summary_is_stale(vitest)`

- [x] **A2** — `detectStaleSummaries` identifies nodes where `generatedAt < updatedAt`
  - A node whose `updatedAt` is newer than its summary's `generatedAt` is reported as stale.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::A2_outdated_summary_is_stale(vitest)`

- [x] **A3** — `detectStaleSummaries` excludes nodes with fresh summaries
  - A node whose summary `generatedAt >= updatedAt` is not reported as stale.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::A3_fresh_summary_not_stale(vitest)`

### Phase B: Incremental Propagation

- [x] **B1** — `propagateSummariesForChangedNodes` regenerates from each changed node to root
  - For a single changed leaf node, summaries are regenerated for the leaf, its parent, and the root.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::B1_propagation_single_node(vitest)`

- [x] **B2** — Ancestor chains are deduplicated when multiple nodes share ancestors
  - When two sibling nodes change, their shared parent and root are only regenerated once.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::B2_deduplication_shared_ancestors(vitest)`

- [x] **B3** — Empty changed node list returns empty results
  - `propagateSummariesForChangedNodes([])` returns `[]` without any LLM calls.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::B3_empty_input(vitest)`

- [x] **B4** — Non-existent node IDs are gracefully skipped
  - If a changed node ID does not exist in the store, it is skipped without error.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::B4_nonexistent_node_skipped(vitest)`

### Phase C: Structured Logging

- [x] **C1** — Incremental propagation emits start and completion events
  - Logged at `info` level with changed node count and total regenerated count.
  - Evidence: `src/__tests__/unit/summaryService.incremental.test.ts::C1_propagation_logging(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Multiple changed nodes in the same subtree could cause redundant ancestor regeneration | Deduplication via a `Set` of already-processed node IDs prevents redundant LLM calls |
| 2 | Staleness detection requires one `getSummary` call per node | Acceptable for incremental indexing where only changed nodes are checked |
| 3 | Ancestor chain ordering matters — parents must be regenerated after their children | Process changed nodes first (deepest first), then ancestors in order; `regenerateFromNode` already handles this |

---

## Implementation Order

1. `src/services/SummaryService.ts` — Add `StaleSummaryInfo` interface and `detectStaleSummaries` method (covers A1, A2, A3)
2. `src/services/SummaryService.ts` — Add `propagateSummariesForChangedNodes` with deduplication (covers B1, B2, B3, B4)
3. `src/services/SummaryService.ts` — Add structured logging for incremental propagation (covers C1)
4. **Verify** — `npm run typecheck && npm run build`
5. `src/__tests__/unit/summaryService.incremental.test.ts` — Write tests for all acceptance criteria (covers A1–C1)
6. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: SUM-2 | Epic: Epic 13 — LLM Summary Generation Service*
