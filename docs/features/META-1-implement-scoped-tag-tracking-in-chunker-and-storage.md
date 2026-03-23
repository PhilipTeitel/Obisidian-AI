# META-1: Implement scoped tag tracking in chunker and storage

**Story**: Implement scoped tag tracking so that frontmatter tags are inherited by all descendant nodes, inline tags are scoped to their containing node, and tags are queryable via a new `getNodesByTag(tag, parentId?)` method on the `HierarchicalStoreContract`.
**Epic**: Epic 16 — Scoped Tags, Cross-References, and Search UX Updates
**Size**: Medium
**Status**: Complete

---

## 1. Summary

The hierarchical chunker (`buildDocumentTree` in `src/utils/chunker.ts`) already extracts frontmatter tags and inline tags and stores them on each `DocumentNode.tags` array. The `SqliteVecRepository` already persists tags via `upsertTags(nodeId, tags)` and the `IndexingService.storeHierarchicalTrees` already calls `upsertTags` for each node with tags.

What is **missing** for the scoped tag tracking requirement (R8) is:

1. **Tag query capability**: A `getNodesByTag(tag: string, parentId?: string)` method on `HierarchicalStoreContract` that returns all nodes matching a given tag, optionally scoped to descendants of a specific parent. This enables queries like "find all nodes tagged X under topic Y".
2. **Tag query tests**: Unit tests verifying that frontmatter tags are inherited by all descendants, inline tags are scoped to their containing node, and the `getNodesByTag` query works correctly with and without parent scoping.
3. **Verification that existing tag inheritance is correct**: The chunker's `createDocumentNode` calls `buildNodeTags(frontmatterTags, inlineTags)` which merges frontmatter tags with inline tags for every node. This means frontmatter tags are already inherited by all descendants. This story verifies and tests this behavior.

No changes are needed to the chunker's tag extraction logic — it already works correctly. The primary deliverable is the new query method and comprehensive tests.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. This is an Obsidian plugin with internal service interfaces only.

The `HierarchicalStoreContract` interface in `src/types.ts` gains one new method:

```ts
export interface HierarchicalStoreContract {
  // ... existing methods ...
  getNodesByTag(tag: string, parentId?: string): Promise<DocumentNode[]>;
}
```

---

## 3. Frontend Flow

No UI changes in this story. The tag query capability is consumed by META-2 (cross-reference retrieval expansion) and META-3 (search view updates) in later stories.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/scopedTagTracking.test.ts` | Unit tests for scoped tag tracking: frontmatter inheritance, inline scoping, `getNodesByTag` queries with and without parent scoping |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add `getNodesByTag(tag: string, parentId?: string): Promise<DocumentNode[]>` to `HierarchicalStoreContract` |
| 2 | `src/storage/SqliteVecRepository.ts` | Implement `getNodesByTag` — iterate nodes matching tag, optionally filter to descendants of parentId |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — tag extraction already works correctly (frontmatter inherited, inline scoped)
- `src/services/IndexingService.ts` — already calls `upsertTags` for each node
- `src/services/SearchService.ts` — no tag-based search in this story
- `src/services/ContextAssemblyService.ts` — no tag-based assembly in this story
- `src/main.ts` — no command or lifecycle changes
- `src/settings.ts` — no settings changes

---

## 5. Acceptance Criteria Checklist

### Phase A: Contract Extension

- [x] **A1** — `HierarchicalStoreContract` includes `getNodesByTag(tag: string, parentId?: string): Promise<DocumentNode[]>`
  - The interface in `src/types.ts` declares the method with the correct signature.
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::A1_getNodesByTag_in_contract(vitest)`

### Phase B: Implementation

- [x] **B1** — `SqliteVecRepository.getNodesByTag(tag)` returns all nodes with the given tag when no parentId is provided
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::B1_getNodesByTag_all(vitest)`

- [x] **B2** — `SqliteVecRepository.getNodesByTag(tag, parentId)` returns only descendant nodes of the given parent that have the tag
  - Descendants are determined by walking the tree from parentId downward (children, grandchildren, etc.).
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::B2_getNodesByTag_scoped(vitest)`

- [x] **B3** — `getNodesByTag` returns an empty array when no nodes match the tag
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::B3_getNodesByTag_no_match(vitest)`

- [x] **B4** — `getNodesByTag` returns an empty array when parentId does not exist
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::B4_getNodesByTag_invalid_parent(vitest)`

### Phase C: Tag Inheritance Verification

- [x] **C1** — Frontmatter tags are present on the root note node
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::C1_frontmatter_tags_on_root(vitest)`

- [x] **C2** — Frontmatter tags are inherited by all descendant nodes (topic, subtopic, paragraph, bullet_group, bullet)
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::C2_frontmatter_tags_inherited(vitest)`

- [x] **C3** — Inline tags are present only on the node whose content contains them (scoped)
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::C3_inline_tags_scoped(vitest)`

- [x] **C4** — A node with both frontmatter and inline tags has the merged set
  - Evidence: `src/__tests__/unit/scopedTagTracking.test.ts::C4_merged_tags(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (no regressions)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | `getNodesByTag` with parentId requires tree traversal to find descendants, which could be slow for large trees | The in-memory Map-based implementation iterates all nodes with the tag and then checks ancestry. For MVP vault sizes (hundreds to low thousands of notes), this is acceptable. |
| 2 | Adding a method to `HierarchicalStoreContract` requires all implementations to be updated | There is only one implementation (`SqliteVecRepository`). The mock in tests will also need updating. |

---

## Implementation Order

1. `src/types.ts` — Add `getNodesByTag` to `HierarchicalStoreContract` (covers A1)
2. `src/storage/SqliteVecRepository.ts` — Implement `getNodesByTag` (covers B1–B4)
3. **Verify** — `npm run typecheck` to confirm no type errors
4. `src/__tests__/unit/scopedTagTracking.test.ts` — Write tests for all acceptance criteria A1–C4
5. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: META-1 | Epic: Epic 16 — Scoped Tags, Cross-References, and Search UX Updates*
