# STO-2: Implement vector store repository for upsert, delete, and nearest-neighbor query

**Story**: Build the repository layer that persists chunk embeddings locally and supports upsert, delete, and cosine-similarity nearest-neighbor retrieval.
**Epic**: Epic 3 — Local Vector Storage and Embedding Providers
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story delivers the operational vector-store repository used by indexing and search flows. The repository must support high-volume note updates while exposing deterministic behavior for upsert/delete/query operations.

The implementation is local-first and plugin-contained. It persists rows under plugin storage state and provides nearest-neighbor retrieval by cosine similarity for downstream semantic search.

This story focuses on repository behavior and service wiring, not final search UI ranking controls (planned in Epic 4).

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed.

The repository should use explicit internal contracts in `src/types.ts`:

```ts
export interface VectorStoreRow {
  chunkId: string;
  notePath: string;
  noteTitle: string;
  heading?: string;
  snippet: string;
  tags: string[];
  embedding: EmbeddingVector;
  updatedAt: number;
}

export interface VectorStoreQuery {
  vector: EmbeddingVector;
  topK: number;
  minScore?: number;
}

export interface VectorStoreMatch extends VectorStoreRow {
  score: number;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
IndexingService
└── LocalVectorStoreRepository
    ├── upsertFromChunks(...)
    ├── deleteByNotePaths(...)
    └── queryNearestNeighbors(...)

SearchService
└── LocalVectorStoreRepository.queryNearestNeighbors(...)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `upsertFromChunks` | `(chunks, vectors) => Promise<void>` | Persisted map/list | Replaces rows by `chunkId` for idempotent reindex behavior |
| `deleteByNotePaths` | `(notePaths: string[]) => Promise<void>` | Persisted map/list | Removes vectors for deleted notes and re-chunked notes |
| `queryNearestNeighbors` | `(query: VectorStoreQuery) => Promise<VectorStoreMatch[]>` | Read-only query | Cosine similarity ranking with top-k and optional min score |
| `SearchService.search` | `(request: SearchRequest)` | Stateless | Produces `SearchResult[]` from vector matches |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not directly UI-facing; synchronous mapping + async repository I/O |
| Error   | Repository read/write failures bubble as normalized runtime errors |
| Empty   | Query on empty store returns `[]` |
| Success | Query returns scored, descending nearest-neighbor matches |

No direct frontend component changes are required for STO-2.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/LocalVectorStoreRepository.ts` | Implement local upsert/delete/query repository behavior |
| 2 | `src/__tests__/unit/localVectorStoreRepository.test.ts` | Unit coverage for repository persistence and nearest-neighbor ranking |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add vector row/query/match contracts and repository interface |
| 2 | `src/services/IndexingService.ts` | Persist embedding vectors via repository during full/incremental runs |
| 3 | `src/services/SearchService.ts` | Query nearest neighbors and map to `SearchResult[]` |
| 4 | `src/bootstrap/bootstrapRuntimeServices.ts` | Construct and pass repository into dependent services |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — semantic search pane rendering is handled in Epic 4
- `src/ui/ChatView.ts` — chat rendering is outside repository scope
- `src/main.ts` — command registration remains unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Repository Operations

- [x] **A1** — Upsert persists vectors by stable chunk identity
  - Upserting existing `chunkId` replaces previous row values.
  - Upserting mixed new/existing chunk IDs is idempotent across repeated runs.

- [x] **A2** — Delete removes vectors for note-level scope
  - Deleting by note path removes all associated rows.
  - Deleting unknown note paths is a no-op and does not throw.

- [x] **A3** — Query returns nearest neighbors in deterministic score order
  - Results are sorted by descending cosine similarity.
  - `topK` and optional `minScore` are both enforced.

### Phase B: Service Integration

- [x] **B1** — Indexing writes vectors to repository in both full and incremental flows
  - Full reindex replaces existing repository rows with current baseline rows.
  - Incremental runs remove deleted-note rows and upsert changed-note rows.

- [x] **B2** — Search reads from repository
  - Search query embedding is produced once and used for nearest-neighbor lookup.
  - Search returns mapped `SearchResult[]` containing note/chunk metadata.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Pure JS similarity math may be slower than sqlite-vec for very large corpora | Keep API compatible with later native sqlite-vec execution path |
| 2 | Dimension mismatches can silently corrupt ranking quality | Validate vector dimensions and skip/throw on malformed rows |
| 3 | Reindex/upsert ordering bugs can leave stale rows | Explicitly clear affected note paths before changed-note upserts |

---

## Implementation Order

1. `src/types.ts` — add vector repository contracts and row/query types (covers A1, A2, A3).
2. `src/storage/LocalVectorStoreRepository.ts` — implement persistence, upsert/delete, and cosine query (covers A1, A2, A3).
3. `src/services/IndexingService.ts` — wire repository writes into full + incremental indexing (covers B1).
4. `src/services/SearchService.ts` — wire repository nearest-neighbor reads (covers B2).
5. `src/bootstrap/bootstrapRuntimeServices.ts` — inject shared repository instance into services (covers B1, B2).
6. `src/__tests__/unit/localVectorStoreRepository.test.ts` + service tests — validate behavior and integration (covers A1-A3, B1-B2).
7. **Final verify** — run `npm run test && npm run lint && npm run build` (covers Z1-Z4).

---

*Created: 2026-02-23 | Story: STO-2 | Epic: Epic 3 — Local Vector Storage and Embedding Providers*
