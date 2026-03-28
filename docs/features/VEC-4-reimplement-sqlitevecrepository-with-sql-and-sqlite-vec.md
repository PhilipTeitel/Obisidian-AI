# VEC-4: Reimplement `SqliteVecRepository` with SQL + sqlite-vec (drop JSON persist)

**Story**: Replace the current JSON / `saveData` persistence and in-memory cosine search in [SqliteVecRepository](../../src/storage/SqliteVecRepository.ts) with **real SQL** and **sqlite-vec** operations implementing the full [HierarchicalStoreContract](../../src/types.ts). Remove `hierarchicalStore` key reads/writes from plugin data.
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: XL
**Status**: Done

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) — §1, §4.2–4.4, §5 (no JSON import), §8 (no index in data.json)
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 4

---

## 1. Summary

**Before (current):** Maps + arrays persisted under `plugin.loadData`/`saveData` key `hierarchicalStore`; vector search is JavaScript cosine over all embeddings.

**After (VEC-4):** All contract methods map to tables defined in [vectorStoreSchema.ts](../../src/storage/vectorStoreSchema.ts) migration `003_hierarchical_model`:

| Contract area | Tables / index |
|---------------|----------------|
| Tree | `nodes`, `node_children` |
| Summaries | `node_summaries` |
| Embeddings | `node_embeddings` (`vec0`) — **summary + content** same table, `embedding_type` column (prompt 05 §4.2) |
| Tags | `node_tags` |
| Cross-refs | `node_cross_refs` |
| Metadata | `metadata` (migration tracking already VEC-3; may store other keys) |

**Search:** `searchSummaryEmbeddings` / `searchContentEmbeddings` use **sqlite-vec** KNN/ANN APIs (not full JS scan) per prompt 05 §4.4.

**Semantics:** Preserve STOR-2 behaviors: `upsertNodeTree` delete-then-insert per note path; `deleteByNotePath` removes dependent rows; `searchContentEmbeddings` optional `parentId` scope; Phase 1 candidate policy unchanged (any summary embedding) per prompt 05 §4.3.

**Remove:** `HIERARCHICAL_STORE_KEY`, `loadState`/`persistState` JSON paths.

---

## 2. API Endpoints + Schemas

No HTTP changes. `HierarchicalStoreContract` remains the public surface; internal deps gain DB handle + path resolver context as needed:

```ts
export interface SqliteVecRepositoryDeps {
  // Illustrative — align with VEC-1/2:
  getDatabasePath: () => string;
  app: App; // or vault reference for vault name if path resolved elsewhere
  // ... spike-specific db factory
}
```

---

## 3. Frontend Flow

N/A.

---

## 4. File Touchpoints

### Files to MODIFY (primary)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/SqliteVecRepository.ts` | SQL + vec implementation |
| 2 | `src/__tests__/unit/sqliteVecRepository.test.ts` | Re-target to file/WASM DB or extracted test harness |

### Files to MODIFY (possible)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/types.ts` | Only if contract needs extension (avoid unless necessary) |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Updated deps for repository |

### Files to DELETE / gut (possible)

| # | Path | Purpose |
|---|------|---------|
| 1 | JSON serialization helpers inside `SqliteVecRepository` | Removed |

---

## 5. Acceptance Criteria Checklist

Map to existing STOR-2 tests where applicable; re-execute against **real** DB.

### Phase A: Lifecycle and no JSON index

- [x] **A1** — `SqliteVecRepository` still implements `HierarchicalStoreContract` + `RuntimeServiceLifecycle`
- [x] **A2** — `plugin.saveData` / `loadData` is **not** used for hierarchical index payload (verify by code search / test spy)
- [x] **A3** — `init()` remains lightweight per REL-1 + prompt 05 §3; heavy work on first DB use is acceptable if documented

### Phase B: Node tree (STOR-2 parity)

- [x] **B1** — `upsertNodeTree` / `getNode` / `getNodesByNotePath` — same semantics as STOR-2 tests
- [x] **B2** — `upsertNodeTree` replaces prior note path data
- [x] **B3** — `deleteByNotePath` removes nodes, children, summaries, vec rows, tags, cross-refs for that note

### Phase C: Traversal (STOR-2 parity)

- [x] **C1** — `getChildren` order matches `sort_order` / `sequenceIndex`
- [x] **C2** — `getAncestorChain` parent walk to root
- [x] **C3** — `getSiblings` includes self, ordered

### Phase D: Vector search (updated — sqlite-vec)

- [x] **D1** — `searchSummaryEmbeddings` uses sqlite-vec against **summary** type only; top-K ordering matches extension distance semantics (document mapping to “score” if not cosine)
- [x] **D2** — `searchContentEmbeddings` uses sqlite-vec for **content** type; respects `parentId` filter when provided
- [x] **D3** — Search is **not** implemented as O(n) JS loop over all embeddings for production path (tests may use small n)

### Phase E: Summaries, tags, cross-refs (STOR-2 parity)

- [x] **E1** — `upsertSummary` / `getSummary`
- [x] **E2** — `upsertTags` + `getNodesByTag` if present on contract
- [x] **E3** — `upsertCrossReferences` / `getCrossReferences`

### Phase F: Transactions

- [x] **F1** — `upsertNodeTree` and `deleteByNotePath` are **atomic** at SQL level (transaction or FK CASCADE documented)

### Phase G: Logging

- [x] **G1** — Structured logging retained for major operations (align with STOR-2 G1)

### Phase Z: Quality gates

- [x] **Z1** — `npm run typecheck && npm run build && npm run test && npm run lint`

---

## 6. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `FLOAT[1536]` vs actual embedding dimensions | Validate at `upsertEmbedding` or follow-up migration story (plan risk register). |
| 2 | Test runtime without WASM | Separate integration job or mocked driver layer. |

---

## 7. Dependencies

- **Blocked by**: VEC-0, VEC-1, VEC-2, VEC-3
- **Blocks**: VEC-5 (cannot remove flat store until hierarchical path works on disk)

---

## 8. Implementation Order

1. Introduce DB access inside repository (lazy) using VEC-2 module
2. Implement CRUD for `nodes` + `node_children` + transactional upsert/delete
3. Implement `node_summaries`, `node_tags`, `node_cross_refs`
4. Implement `upsertEmbedding` + vec table maintenance on node delete
5. Replace search methods with sqlite-vec queries
6. Delete JSON persistence; update tests
7. Full test pass + manual reindex smoke

---

*Story: VEC-4 | Epic 19 | Prompt 05 §1, §4, §8 + plan Phase 4*
