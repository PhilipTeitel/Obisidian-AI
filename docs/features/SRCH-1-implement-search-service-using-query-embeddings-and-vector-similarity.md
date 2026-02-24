# SRCH-1: Implement search service using query embeddings and vector similarity

**Story**: Deliver a production-ready `SearchService` that embeds user queries and returns ranked semantic matches with note metadata and excerpts.
**Epic**: Epic 4 — Semantic Search Experience
**Size**: Medium
**Status**: Done

---

## 1. Summary

SRCH-1 establishes the backend retrieval layer for semantic search in the plugin runtime. The service must convert free-text query input into an embedding vector, run nearest-neighbor similarity against locally persisted chunk embeddings, and return deterministic ranked matches that downstream callers can render without additional enrichment.

This story is the service foundation for Epic 4. SRCH-2 (search pane UI), SRCH-3 (search-selection command UX), and SRCH-4 (result navigation) all depend on SRCH-1 returning stable, typed, metadata-rich search results. If this contract is ambiguous or unstable, each downstream story will need duplicated mapping logic and error handling.

The guiding constraint is strict separation of responsibilities: provider/model resolution and embedding execution stay in `EmbeddingService`, vector math and top-k/min-score filtering stay in `LocalVectorStoreRepository`, and `SearchService` remains a thin orchestration/mapping layer with deterministic behavior, input guards, and explicit contracts.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed for SRCH-1.

This repository is an Obsidian plugin and does not use `shared/types.ts`; SRCH-1 contract updates should be defined in `src/types.ts`.

`SearchRequest` and `SearchResult` should be the authoritative runtime contract for semantic retrieval:

```ts
export interface SearchRequest {
  query: string; // raw query text from pane or command
  topK: number; // max result count requested by caller
  minScore?: number; // optional cosine-similarity threshold
}

export interface SearchResult {
  chunkId: string;
  score: number; // cosine similarity score, higher is better
  notePath: string;
  noteTitle: string;
  heading?: string;
  snippet: string; // short excerpt for result preview
  tags: string[]; // normalized chunk tags for UI chips/filters
}
```

No additional schemas are required beyond these internal TypeScript contracts.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Semantic search caller (SRCH-2 pane or SRCH-3 command)
└── SearchService.search(request)
    ├── EmbeddingService.embed({ providerId, model, inputs: [query] })
    │   └── ProviderRegistry + active embedding provider
    ├── LocalVectorStoreRepository.queryNearestNeighbors({ vector, topK, minScore })
    └── SearchResult[] (ranked, metadata-enriched)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchService.search` | `(request: SearchRequest) => Promise<SearchResult[]>` | Stateless + disposed guard | Main semantic retrieval path for pane/command callers |
| `SearchService.searchSelection` | `(selection: string) => Promise<SearchResult[]>` | Stateless + disposed guard | Convenience wrapper using default `topK=5` for selection-driven search |
| `EmbeddingService.embed` | `(request: EmbeddingRequest) => Promise<EmbeddingResponse>` | Provider/model-driven | Produces query vector using active embedding provider config |
| `VectorStoreRepository.queryNearestNeighbors` | `(query: VectorStoreQuery) => Promise<VectorStoreMatch[]>` | Read-only persisted rows | Returns scored nearest chunks, filtered by `topK` and optional `minScore` |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Caller shows loading UI while `search()` awaits embedding + repository query |
| Error   | Dependency failures surface as normalized runtime errors for caller notice/logging paths |
| Empty   | Blank/invalid query or no nearest matches returns `[]` without throwing |
| Success | Returns ranked `SearchResult[]` containing score, note metadata, snippet, and tags |

No direct frontend component implementation is required in SRCH-1; SRCH-2 will consume this service contract.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/searchService.test.ts` | Dedicated unit coverage for query embedding, vector query parameters, result mapping, and guard/error behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Finalize `SearchRequest`/`SearchResult` contracts (including result tag metadata) used by search callers |
| 2 | `src/services/SearchService.ts` | Implement/complete query guards, embedding call, nearest-neighbor lookup, deterministic result mapping, and normalized error boundaries |
| 3 | `src/__tests__/unit/services.runtime.test.ts` | Keep runtime service smoke expectations aligned with finalized search behavior |
| 4 | `src/__tests__/smoke.test.ts` | Update compile-safe contract assertions for any `SearchResult` type changes |

### Files UNCHANGED (confirm no modifications needed)

- `src/storage/LocalVectorStoreRepository.ts` — nearest-neighbor vector query behavior is owned by STO-2 and should be consumed as-is.
- `src/ui/SearchView.ts` — full search pane rendering belongs to SRCH-2.
- `src/main.ts` — command-level UX and notice wiring for semantic search selection belongs to SRCH-3.

---

## 5. Acceptance Criteria Checklist

### Phase A: Query Embedding + Vector Retrieval

- [x] **A1** — `search()` embeds exactly one query input using active provider/model settings
  - `SearchService` calls `EmbeddingService.embed` once with `inputs: [request.query]`.
  - The `providerId` and `model` values come from current plugin settings.
  - Evidence: `src/__tests__/unit/searchService.test.ts::A1_embeds_query_with_active_provider(vitest)`

- [x] **A2** — `search()` forwards vector retrieval controls correctly
  - The repository query includes the embedded query vector plus caller-provided `topK` and optional `minScore`.
  - Non-positive `topK` values return `[]` without repository calls.
  - Evidence: `src/__tests__/unit/searchService.test.ts::A2_forwards_topk_and_minscore(vitest)`

- [x] **A3** — Search results return ranked metadata and excerpts required by Epic 4 consumers
  - Returned rows preserve repository ranking order.
  - Every `SearchResult` includes `chunkId`, `score`, `notePath`, `noteTitle`, optional `heading`, `snippet`, and normalized `tags`.
  - Evidence: `src/__tests__/unit/searchService.test.ts::A3_maps_ranked_results_with_metadata(vitest)`

### Phase B: Service Robustness + Contracts

- [x] **B1** — Disposed service guard prevents post-dispose search calls
  - After `dispose()`, both `search()` and `searchSelection()` reject with a clear service-disposed error.
  - Evidence: `src/__tests__/unit/searchService.test.ts::B1_rejects_when_disposed(vitest)`

- [x] **B2** — Dependency failures are normalized with actionable runtime context
  - Embedding or repository errors are wrapped/normalized with operation context before rethrowing.
  - Error surface remains compatible with plugin-level notice/log pipelines.
  - Evidence: `src/__tests__/unit/searchService.test.ts::B2_normalizes_dependency_failures(vitest)`

- [x] **B3** — `searchSelection()` delegates to `search()` with stable defaults
  - Selection-based search uses `topK=5` by default.
  - Empty/whitespace-only selection returns `[]` and does not call embedding.
  - Evidence: `src/__tests__/unit/searchService.test.ts::B3_selection_path_defaults_and_guards(vitest)`

### Phase C: Runtime Compatibility

- [x] **C1** — Runtime test suite reflects finalized search contract
  - Existing runtime smoke/integration coverage compiles and passes with SRCH-1 contract updates.
  - Any contract field additions are reflected in compile-safe assertions.
  - Evidence: `src/__tests__/smoke.test.ts::C1_search_contract_compile_safety(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`

- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`

- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/unit/searchService.test.ts::Z3_no_any_types(eslint)`

- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; SRCH-1 must not introduce relative imports that would conflict with this rule when shared types are added later.
  - Evidence: `src/types.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Empty or low-quality queries can produce noisy nearest-neighbor matches | Add input guards and allow `minScore` filtering so callers can suppress low-confidence results |
| 2 | Contract drift between service and upcoming UI stories can cause duplicated mapping logic | Keep `SearchResult` as a single source of truth in `src/types.ts` and enforce with compile + unit tests |
| 3 | Over-normalizing errors in service layer could hide root causes during debugging | Preserve original cause in normalized error context and keep operation-scoped metadata |

---

## Implementation Order

1. `src/types.ts` — finalize `SearchRequest`/`SearchResult` contracts needed by SRCH-2/SRCH-3 consumers (covers A3, C1).
2. `src/services/SearchService.ts` — implement query guards, embedding orchestration, vector lookup, result mapping, and normalized error boundaries (covers A1, A2, A3, B1, B2, B3).
3. `src/__tests__/unit/searchService.test.ts` — add focused unit coverage for happy-path retrieval, contract mapping, disposal guard, and error handling (covers A1, A2, A3, B1, B2, B3).
4. `src/__tests__/unit/services.runtime.test.ts` and `src/__tests__/smoke.test.ts` — align runtime smoke/contract checks with finalized search output shape (covers C1).
5. **Verify** — run `npm run test -- searchService` (or equivalent Vitest filter) to validate SRCH-1 behavior before full suite.
6. **Final verify** — run `npm run lint && npm run build && npm run test` to satisfy quality gates (covers Z1, Z2, Z3, Z4).

---

*Created: 2026-02-24 | Story: SRCH-1 | Epic: Epic 4 — Semantic Search Experience*
