# VEC-5: Remove flat store; hierarchical-only search in UI and services

**Story**: Remove [LocalVectorStoreRepository](../../src/storage/LocalVectorStoreRepository.ts) and all **flat** indexing and **flat** semantic search paths. Wire [main.ts](../../src/main.ts), [SearchService](../../src/services/SearchService.ts), [IndexingService](../../src/services/IndexingService.ts), [ChatService](../../src/services/ChatService.ts), and bootstrap so **only** the hierarchical + sqlite-backed store is used.
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: Large
**Status**: Not Started

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) — §4 (remove flat), §6, §1.6 privacy preserved by per-vault DB file (VEC-1)
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 5

---

## 1. Summary

Prompt 05 §6 requires:

- Remove **`LocalVectorStoreRepository`** from indexing and search.
- Remove **dual-write** in `IndexingService` (`replaceAllFromChunks`, `upsertFromChunks`, `deleteByNotePaths`).
- Remove flat **semantic search** (`SearchService.search` → `vectorStoreRepository.queryNearestNeighbors`).
- Update UI wiring: today [main.ts](../../src/main.ts) `SearchPaneModel.runSearch` calls `searchService.search` (flat) and adapts via `adaptSearchResultToHierarchical`; **ChatPaneModel** `runSourceSearch` does the same.

**Target:** Single search path: **hierarchical** phases (embed query → Phase 1 summary → Phase 2 drill-down → map to `HierarchicalSearchResult` / `SearchResult` as UI requires). Prefer consolidating orchestration inside `SearchService` so `main.ts` calls one method.

Also remove **`vectorStoreRepository`** from [RuntimeServices](../../src/types.ts), [ServiceContainer](../../src/services/ServiceContainer.ts), and [bootstrapRuntimeServices](../../src/bootstrap/bootstrapRuntimeServices.ts) if no remaining consumer. Grep for `VectorStoreRepositoryContract`, `vectorStore`, `chunkId` search paths.

---

## 2. API Endpoints + Schemas

### Public plugin API (if any)

Audit [main.ts](../../src/main.ts) `searchSemantic` or similar exports — must return hierarchical-shaped results or updated contract.

### Type cleanup

- Remove or narrow `VectorStoreRepositoryContract`, `VectorStoreRow`, etc., if unused.
- Keep types still needed for manifests or unrelated features only if required.

---

## 3. Frontend Flow

### Search pane

- `SearchPaneModel` continues to show hierarchical results; data source is hierarchical pipeline only.

### Chat pane

- Source search uses hierarchical retrieval (top-K policy may match previous flat `topK: 5` or follow SearchService constants).

---

## 4. File Touchpoints

### Files to MODIFY (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/bootstrap/bootstrapRuntimeServices.ts` | Drop `LocalVectorStoreRepository` |
| 2 | `src/services/ServiceContainer.ts` | Remove `vectorStoreRepository` field if unused |
| 3 | `src/types.ts` | `RuntimeServices` without flat store |
| 4 | `src/services/IndexingService.ts` | Remove all flat chunk embed/store calls |
| 5 | `src/services/SearchService.ts` | Hierarchical-only `search`; drop flat deps |
| 6 | `src/services/ChatService.ts` | Hierarchical source search |
| 7 | `src/main.ts` | Wire `runSearch` / `runSourceSearch` to new API |
| 8 | `src/ui/SearchPaneModel.ts` | Only if signature/adapter changes |
| 9 | All tests referencing `vectorStoreRepository` or `LocalVectorStoreRepository` | Update mocks |

### Files to DELETE (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/LocalVectorStoreRepository.ts` | Removed |
| 2 | `src/__tests__/unit/localVectorStoreRepository.test.ts` | Removed |
| 3 | `src/storage/vectorStorePaths.ts` | Remove if nothing imports; or slim if still used for unrelated metadata until deleted |

### Files to AUDIT

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/AgentService.ts` | Grep for vector store usage |
| 2 | `scripts/query-store.mjs` | VEC-6 updates for SQLite file |
| 3 | Integration / e2e tests | `coreJourneys`, `scaleValidation` |

---

## 5. Acceptance Criteria Checklist

### Phase A: Bootstrap and types

- [ ] **A1** — `LocalVectorStoreRepository` not constructed anywhere
- [ ] **A2** — `RuntimeServices` / `ServiceContainer` expose no `vectorStoreRepository` unless a non-search consumer remains (should not)
- [ ] **A3** — Typecheck clean after type pruning

### Phase B: Indexing

- [ ] **B1** — `IndexingService` never calls `replaceAllFromChunks`, `upsertFromChunks`, or `deleteByNotePaths` on flat repo
- [ ] **B2** — Full and incremental reindex still populate hierarchical store only
- [ ] **B3** — Progress stages no longer imply flat “chunk store” finalize (update copy if needed)

### Phase C: Search and chat

- [ ] **C1** — `SearchService.search` (or replacement public method) uses hierarchical store + embedding service only
- [ ] **C2** — Search pane returns results without flat intermediate step
- [ ] **C3** — Chat source search uses hierarchical path
- [ ] **C4** — `hierarchicalStore` on `SearchServiceDeps` is **required** if search always hierarchical (remove optional `?`)

### Phase D: Cleanup

- [ ] **D1** — Dead code removed (`adaptSearchResultToHierarchical` if obsolete)
- [ ] **D2** — `npm run test` all green

### Phase Z: Quality gates

- [ ] **Z1** — `npm run typecheck && npm run build && npm run test && npm run lint`

---

## 6. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | External API consumers relied on flat `SearchResult` shape | Keep adapter at boundary if public API must stay stable. |
| 2 | Large test surface | Grep-driven checklist; fix e2e last. |

---

## 7. Dependencies

- **Blocked by**: VEC-4 (hierarchical store must work on disk)
- **Parallel**: VEC-6 can start docs; query script finalized after paths stable

---

## 8. Implementation Order

1. Grep `vectorStoreRepository` / `LocalVectorStoreRepository` / `queryNearestNeighbors`
2. Implement hierarchical `search` orchestration in `SearchService`
3. Rewire `main.ts` chat + search
4. Strip `IndexingService` flat calls
5. Remove bootstrap + container + types
6. Delete flat repository + tests
7. Fix integration tests and run full suite

---

*Story: VEC-5 | Epic 19 | Prompt 05 §4, §6 + plan Phase 5*
