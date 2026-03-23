# META-2: Implement cross-reference tracking and retrieval expansion

**Story**: Implement cross-reference tracking so that wikilinks parsed during chunking are stored in `node_cross_refs` and can be followed during retrieval to expand context with related material from other notes/topics.
**Epic**: Epic 16 — Scoped Tags, Cross-References, and Search UX Updates
**Size**: Medium
**Status**: Complete

---

## 1. Summary

The hierarchical chunker (`buildDocumentTree`) already extracts wikilinks via `extractWikilinks()` from `src/utils/wikilinkParser.ts` and returns them as `CrossReference[]`. The `IndexingService.storeHierarchicalTrees` already stores them via `hierarchicalStore.upsertCrossReferences()`. The `SqliteVecRepository` already persists and retrieves cross-references via `upsertCrossReferences(refs)` and `getCrossReferences(nodeId)`.

What is **missing** for the cross-reference tracking requirement (R9) is:

1. **Retrieval expansion**: A method on `ContextAssemblyService` (or a utility) that, given a set of matched leaf nodes, follows their cross-references to find related nodes in other notes and includes them as additional context blocks. This is the "optionally follow cross-references to expand context with related material" capability.
2. **Cross-reference resolution**: A `resolveTargetNodes(targetPath)` method on `HierarchicalStoreContract` that finds the root node for a given target path, enabling cross-reference following.
3. **Tests**: Unit tests verifying cross-reference storage, retrieval, resolution, and context expansion.

The expansion is opt-in: when cross-references are found for matched nodes, their target notes' summary nodes are included as additional context blocks (using the parent summary budget). This enriches the context without requiring separate embedding searches.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. This is an Obsidian plugin with internal service interfaces only.

The `HierarchicalStoreContract` interface in `src/types.ts` gains one new method:

```ts
export interface HierarchicalStoreContract {
  // ... existing methods ...
  getNodesByNotePath(notePath: string): Promise<DocumentNode[]>;  // already exists
  getCrossReferences(nodeId: string): Promise<CrossReference[]>;  // already exists
}
```

No new interface methods are needed — the existing `getCrossReferences` and `getNodesByNotePath` are sufficient for cross-reference following.

The `ContextAssemblyService` gains a new internal method `expandWithCrossReferences` that:
1. Collects cross-references from all matched leaf nodes
2. For each unique target path, finds the root note node
3. Fetches the root node's summary
4. Includes it as an additional context block (charged against the parent summary budget)

---

## 3. Frontend Flow

No UI changes in this story. The expanded context flows through the existing chat and search pipelines.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/crossReferenceTracking.test.ts` | Unit tests for cross-reference storage, retrieval, resolution, and context expansion |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/ContextAssemblyService.ts` | Add `expandWithCrossReferences` internal method that follows cross-refs from matched nodes, fetches target note summaries, and appends additional context blocks within the parent summary budget |

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — no new types needed; `CrossReference`, `HierarchicalStoreContract` already sufficient
- `src/utils/wikilinkParser.ts` — already correctly extracts wikilinks
- `src/utils/chunker.ts` — already calls `extractWikilinks` and returns cross-references
- `src/services/IndexingService.ts` — already stores cross-references during indexing
- `src/storage/SqliteVecRepository.ts` — already implements `upsertCrossReferences` and `getCrossReferences`
- `src/services/SearchService.ts` — no changes needed; cross-ref expansion happens in context assembly

---

## 5. Acceptance Criteria Checklist

### Phase A: Cross-Reference Storage Verification

- [x] **A1** — Cross-references extracted during chunking are stored and retrievable via `getCrossReferences(nodeId)`
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::A1_cross_refs_stored_and_retrievable(vitest)`

- [x] **A2** — Cross-references include both `targetPath` and `targetDisplay` (when using `[[target|display]]` syntax)
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::A2_cross_refs_include_display(vitest)`

- [x] **A3** — Cross-references from code fences are excluded
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::A3_code_fence_exclusion(vitest)`

### Phase B: Context Expansion

- [x] **B1** — `ContextAssemblyService.assemble()` follows cross-references from matched nodes and includes target note summaries as additional context blocks
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::B1_cross_ref_expansion(vitest)`

- [x] **B2** — Cross-reference expansion charges against the parent summary budget
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::B2_budget_enforcement(vitest)`

- [x] **B3** — Cross-reference expansion deduplicates target paths (same target referenced by multiple matched nodes produces only one expansion block)
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::B3_deduplication(vitest)`

- [x] **B4** — Cross-reference expansion gracefully handles missing target notes (target path not indexed)
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::B4_missing_target(vitest)`

- [x] **B5** — When no cross-references exist, assembly behaves identically to before (no regression)
  - Evidence: `src/__tests__/unit/crossReferenceTracking.test.ts::B5_no_cross_refs(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (no regressions)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Cross-reference expansion could add significant token usage to the parent summary budget | Expansion is bounded by the existing parent summary budget. Once the budget is exhausted, no more cross-ref expansions are added. |
| 2 | Following cross-references requires additional store queries per matched node | The number of matched nodes is bounded by the retrieval top-K (typically 5-10). Each cross-ref lookup is a Map get, which is O(1). |
| 3 | Target notes may not be indexed yet (e.g., linked to a note outside indexed folders) | Gracefully skip unresolved targets. Log a debug event for observability. |

---

## Implementation Order

1. `src/services/ContextAssemblyService.ts` — Add `expandWithCrossReferences` method and call it at the end of `assemble()` (covers B1–B5)
2. **Verify** — `npm run typecheck && npm run build`
3. `src/__tests__/unit/crossReferenceTracking.test.ts` — Write tests for all acceptance criteria A1–B5
4. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: META-2 | Epic: Epic 16 — Scoped Tags, Cross-References, and Search UX Updates*
