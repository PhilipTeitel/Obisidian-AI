# RET-2: Implement Phase 2 drill-down search in SearchService

**Story**: Add a `hierarchicalSearchPhase2` method to `SearchService` that takes Phase 1 candidate nodes and drills down into their children's content embeddings to find high-similarity leaf nodes.
**Epic**: Epic 14 — Three-Phase Hierarchical Retrieval
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story delivers Phase 2 of the three-phase hierarchical retrieval strategy (R6). For each Phase 1 candidate node, the method searches children's **content embeddings** recursively until high-similarity leaf nodes are found. Results are deduplicated across ancestor paths and returned as `LeafMatch[]` with ancestor chains.

Key design decisions:
- **Recursive drill-down**: For each Phase 1 candidate, search its children's content embeddings. If a child is a non-leaf node with high similarity, recurse into its children.
- **Leaf collection**: Collect leaf nodes (paragraphs, bullets) that have high content similarity to the query.
- **Deduplication**: If the same leaf node appears via multiple ancestor paths, keep only the highest-scoring occurrence.
- **Ancestor chain**: Each `LeafMatch` includes the full ancestor chain from the leaf to the root for Phase 3 context assembly.
- **Configurable drill-down depth**: Uses a max recursion depth to prevent runaway traversal.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. Internal service interface additions:

```ts
// Added to SearchService:
hierarchicalSearchPhase2(
  candidates: NodeMatch[],
  queryVector: EmbeddingVector,
  topK: number
): Promise<LeafMatch[]>;
```

---

## 3. Frontend Flow

No frontend components are created or modified. The method is consumed by the full hierarchical search flow.

---

## 4. File Touchpoints

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/SearchService.ts` | Add `hierarchicalSearchPhase2` method |
| 2 | `src/__tests__/unit/hierarchicalSearch.test.ts` | Add Phase 2 tests |

### Files UNCHANGED

- `src/types.ts` — `LeafMatch`, `NodeMatch`, `DocumentNode` already defined
- `src/storage/SqliteVecRepository.ts` — `searchContentEmbeddings`, `getNode`, `getChildren`, `getAncestorChain` already implemented

---

## 5. Acceptance Criteria Checklist

### Phase A: Drill-Down Logic

- [x] **A1** — `hierarchicalSearchPhase2` searches children's content embeddings for each candidate
  - For each Phase 1 `NodeMatch`, calls `searchContentEmbeddings` scoped to that node's children.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A1_searches_children_content(vitest)`

- [x] **A2** — Recursively drills into non-leaf children with high similarity
  - If a matched child is a non-leaf node, its children are also searched.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A2_recursive_drill_down(vitest)`

- [x] **A3** — Collects leaf nodes as final matches
  - Leaf nodes (paragraph, bullet) are collected as `LeafMatch` results.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A3_collects_leaf_nodes(vitest)`

- [x] **A4** — Deduplicates leaf nodes across ancestor paths
  - If the same leaf appears via multiple Phase 1 candidates, only the highest-scoring occurrence is kept.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A4_deduplicates_leaves(vitest)`

- [x] **A5** — Each `LeafMatch` includes the ancestor chain
  - The `ancestorChain` field contains all ancestor nodes from leaf to root.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A5_includes_ancestor_chain(vitest)`

### Phase B: Edge Cases

- [x] **B1** — Empty candidates array returns empty results
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B1_empty_candidates(vitest)`

- [x] **B2** — Candidates with no children return empty results
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B2_no_children(vitest)`

### Phase C: Structured Logging

- [x] **C1** — Emits `retrieval.phase2.completed` event on success
  - Logged at `info` level with `candidateCount`, `leafMatchCount`, `elapsedMs`.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::C1_phase2_completed_event(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes (or only pre-existing warnings)
- [x] **Z3** — No `any` types in new/modified code
- [x] **Z4** — All existing tests continue to pass

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Deep recursion for heavily nested documents | Max recursion depth limit prevents runaway traversal |
| 2 | Many Phase 1 candidates could cause many store queries | topK limits the number of results per level |

---

## Implementation Order

1. `src/services/SearchService.ts` — Implement `hierarchicalSearchPhase2` method (covers A1–A5, B1–B2)
2. `src/services/SearchService.ts` — Add structured logging (covers C1)
3. `src/__tests__/unit/hierarchicalSearch.test.ts` — Add Phase 2 tests (covers all criteria)
4. **Final verify** — `npm run test && npm run lint` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: RET-2 | Epic: Epic 14 — Three-Phase Hierarchical Retrieval*
