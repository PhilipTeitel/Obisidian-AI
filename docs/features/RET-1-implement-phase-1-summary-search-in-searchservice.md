# RET-1: Implement Phase 1 summary search in SearchService

**Story**: Add a `hierarchicalSearch` method to `SearchService` that performs Phase 1 of the three-phase hierarchical retrieval — searching summary embeddings only to return top-K candidate topic/subtopic nodes.
**Epic**: Epic 14 — Three-Phase Hierarchical Retrieval
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story delivers Phase 1 of the three-phase hierarchical retrieval strategy described in requirement R6. A new `hierarchicalSearch` method is added to `SearchService` that embeds the user's query and searches against **summary embeddings only** (via `HierarchicalStoreContract.searchSummaryEmbeddings`), returning top-K candidate nodes.

The method accepts a `HierarchicalSearchRequest` with `query`, `topK`, and optional `minScore` parameters. It returns `NodeMatch[]` representing the coarse-grained candidate nodes that Phase 2 will drill into.

Phase 1 is the entry point for hierarchical retrieval. It intentionally searches only summary embeddings (not content embeddings) to find the most relevant topic/subtopic-level nodes before drilling down to leaf content in Phase 2.

Key design decisions:
- **Summary-only search**: Phase 1 searches `embeddingType = "summary"` vectors only, which represent topic/subtopic/note-level summaries.
- **Reuses existing embedding infrastructure**: The query is embedded via the same `EmbeddingService` used by flat search.
- **Structured logging**: Emits `retrieval.phase1.completed` event with timing, result count, and query metadata.
- **Separate from flat search**: The existing `search()` method is preserved for backward compatibility; `hierarchicalSearch` is a new code path.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. Internal service interface additions:

```ts
export interface HierarchicalSearchRequest {
  query: string;
  topK: number;
  minScore?: number;
}

// Added to SearchService:
hierarchicalSearchPhase1(request: HierarchicalSearchRequest): Promise<NodeMatch[]>;
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created or modified in this story. The method is consumed by Phase 2 (RET-2).

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchService.hierarchicalSearchPhase1` | `(request: HierarchicalSearchRequest) => Promise<NodeMatch[]>` | Stateless per call | Phase 1 summary search |

### 3c. States

| State   | Behavior |
|---------|----------|
| Empty query | Returns empty array |
| No matches | Returns empty array |
| Success | Returns top-K `NodeMatch[]` sorted by score descending |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/hierarchicalSearch.test.ts` | Unit tests for Phase 1 hierarchical search |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/SearchService.ts` | Add `hierarchicalSearchPhase1` method, add `HierarchicalStoreContract` to deps |
| 2 | `src/types.ts` | Add `HierarchicalSearchRequest` interface |

### Files UNCHANGED

- `src/storage/SqliteVecRepository.ts` — `searchSummaryEmbeddings` already implemented
- `src/bootstrap/bootstrapRuntimeServices.ts` — wiring updates happen in INTG-1

---

## 5. Acceptance Criteria Checklist

### Phase A: Service Extension

- [x] **A1** — `SearchService` accepts `HierarchicalStoreContract` in its deps
  - `SearchServiceDeps` includes an optional `hierarchicalStore` field.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A1_deps_include_hierarchical_store(vitest)`

- [x] **A2** — `HierarchicalSearchRequest` type is defined in `types.ts`
  - Includes `query: string`, `topK: number`, `minScore?: number`.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::A2_request_type_defined(vitest)`

### Phase B: Phase 1 Search Logic

- [x] **B1** — `hierarchicalSearchPhase1` embeds the query using `EmbeddingService`
  - The query string is sent to the embedding provider and a vector is returned.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B1_embeds_query(vitest)`

- [x] **B2** — `hierarchicalSearchPhase1` searches summary embeddings via `HierarchicalStoreContract`
  - Calls `searchSummaryEmbeddings` with the query vector and `topK`.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B2_searches_summary_embeddings(vitest)`

- [x] **B3** — Results are filtered by `minScore` when provided
  - Matches below `minScore` are excluded from the returned array.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B3_filters_by_min_score(vitest)`

- [x] **B4** — Empty or whitespace-only queries return an empty array
  - No embedding call or store search is made.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B4_empty_query_returns_empty(vitest)`

- [x] **B5** — Non-positive `topK` returns an empty array
  - No embedding call or store search is made.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::B5_non_positive_topk_returns_empty(vitest)`

### Phase C: Structured Logging

- [x] **C1** — Emits `retrieval.phase1.completed` event on success
  - Logged at `info` level with `resultCount`, `embeddingElapsedMs`, `searchElapsedMs`, `elapsedMs`.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::C1_phase1_completed_event(vitest)`

- [x] **C2** — Emits `retrieval.phase1.failed` event on error
  - Logged at `error` level with normalized error.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::C2_phase1_failed_event(vitest)`

### Phase D: Error Handling

- [x] **D1** — Disposed service throws on `hierarchicalSearchPhase1`
  - After calling `dispose()`, `hierarchicalSearchPhase1` throws.
  - Evidence: `src/__tests__/unit/hierarchicalSearch.test.ts::D1_disposed_throws(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Phase 1 alone doesn't produce user-facing results | Phase 2 (RET-2) builds on this; Phase 1 is a building block |
| 2 | Summary embeddings may not exist yet (pre-INTG pipeline) | Method returns empty results gracefully; no crash |
| 3 | Adding `hierarchicalStore` to SearchService deps changes the interface | Made optional to preserve backward compatibility |

---

## Implementation Order

1. `src/types.ts` — Add `HierarchicalSearchRequest` interface (covers A2)
2. `src/services/SearchService.ts` — Add `hierarchicalStore` to `SearchServiceDeps` (covers A1)
3. `src/services/SearchService.ts` — Implement `hierarchicalSearchPhase1` method (covers B1–B5)
4. `src/services/SearchService.ts` — Add structured logging (covers C1, C2)
5. `src/services/SearchService.ts` — Add disposed check (covers D1)
6. `src/__tests__/unit/hierarchicalSearch.test.ts` — Write comprehensive tests (covers A1–D1)
7. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: RET-1 | Epic: Epic 14 — Three-Phase Hierarchical Retrieval*
