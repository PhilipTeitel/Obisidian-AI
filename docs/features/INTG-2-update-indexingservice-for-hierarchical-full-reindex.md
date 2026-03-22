# INTG-2: Update IndexingService for hierarchical full reindex

**Story**: Replace the flat chunk → embed flow in `runFullReindex` with a hierarchical pipeline: build document trees, store nodes, generate summaries, and embed both content and summaries.
**Epic**: Epic 15 — Hierarchical Indexing Pipeline Integration
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story rewires the `runFullReindex` method in `IndexingService` to use the hierarchical document model introduced in Epics 11–14. Today, `runFullReindex` calls `chunkMarkdownNote()` to produce flat `ChunkRecord[]`, embeds chunk content strings via `EmbeddingService.embed()`, and stores them via `vectorStoreRepository.replaceAllFromChunks()`. The progress stages are Crawl → Chunk → Embed → Finalize.

After this story, `runFullReindex` will additionally:

1. **Build document trees** — For each crawled note, call `buildDocumentTree()` from `src/utils/chunker.ts` to produce a `DocumentTree` and `CrossReference[]`.
2. **Store hierarchical nodes** — Persist each tree via `hierarchicalStore.upsertNodeTree(tree)`, then store cross-references via `hierarchicalStore.upsertCrossReferences(crossRefs)` and tags via `hierarchicalStore.upsertTags(nodeId, tags)` for every node in the tree.
3. **Generate summaries** — Call `summaryService.generateSummaries(tree)` for each tree, producing bottom-up LLM summaries for non-leaf nodes. This introduces a new "Summarize" progress stage.
4. **Embed content and summaries** — For leaf nodes (paragraph, bullet), embed `node.content` as `EmbeddingType = "content"`. For non-leaf nodes (note, topic, subtopic, bullet_group), embed the summary text as `EmbeddingType = "summary"`. Store each embedding via `hierarchicalStore.upsertEmbedding(nodeId, embeddingType, vector)`.
5. **Update progress stages** — The new stage sequence is: Crawl → Chunk → Store → Summarize → Embed → Finalize.

The existing flat pipeline (`chunkMarkdownNote` → `vectorStoreRepository.replaceAllFromChunks`) is **retained** and runs alongside the hierarchical pipeline. This dual-write approach ensures the flat search/chat path remains functional until the retrieval layer is fully switched over in later stories. The flat pipeline will be removed in a future cleanup story.

Two new dependencies are added to `IndexingServiceDeps`: `summaryService: SummaryServiceContract` and `hierarchicalStore: HierarchicalStoreContract`. Both are already wired into the runtime by INTG-1.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

Updated `IndexingServiceDeps` interface in `src/services/IndexingService.ts`:

```ts
export interface IndexingServiceDeps {
  app: RuntimeBootstrapContext["app"];
  embeddingService: EmbeddingServiceContract;
  vectorStoreRepository: VectorStoreRepositoryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
  manifestStore: IndexManifestStore;
  jobStateStore: IndexJobStateStore;
  summaryService: SummaryServiceContract;
  hierarchicalStore: HierarchicalStoreContract;
}
```

Key method signatures consumed by the new pipeline:

```ts
// From src/utils/chunker.ts
buildDocumentTree(input: ChunkerInput, options?: HierarchicalChunkerOptions): HierarchicalChunkerResult
// where HierarchicalChunkerResult = { tree: DocumentTree; crossReferences: CrossReference[] }

// From SummaryServiceContract
generateSummaries(tree: DocumentTree, options?: SummaryGenerationOptions): Promise<SummaryGenerationResult[]>

// From HierarchicalStoreContract
upsertNodeTree(tree: DocumentTree): Promise<void>
upsertCrossReferences(refs: CrossReference[]): Promise<void>
upsertTags(nodeId: string, tags: string[]): Promise<void>
upsertEmbedding(nodeId: string, embeddingType: EmbeddingType, vector: EmbeddingVector): Promise<void>

// From EmbeddingServiceContract
embed(request: EmbeddingRequest): Promise<EmbeddingResponse>
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created. The changes are entirely within the service layer:

```
src/services/IndexingService.ts (modified)
├── runFullReindex() — adds hierarchical pipeline alongside flat pipeline
├── New: buildAndStoreDocumentTrees() — build trees, store nodes/tags/cross-refs
├── New: generateTreeSummaries() — call summaryService for each tree
├── New: embedHierarchicalNodes() — embed content + summaries via hierarchicalStore
└── IndexingServiceDeps — add summaryService, hierarchicalStore

src/bootstrap/bootstrapRuntimeServices.ts (modified)
└── Pass summaryService and hierarchicalStore to IndexingService constructor

src/__tests__/unit/indexing.hierarchicalReindex.test.ts (new)
└── Tests for hierarchical reindex pipeline
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `IndexingServiceDeps` | Add `summaryService: SummaryServiceContract`, `hierarchicalStore: HierarchicalStoreContract` | N/A | New required deps |
| `runFullReindex` | Same params, extended internal pipeline | N/A | Adds hierarchical steps after flat pipeline |
| Progress stages | Crawl → Chunk → Store → Summarize → Embed → Finalize | N/A | Two new stages: Store and Summarize |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Progress slideout shows new stages (Store, Summarize) with note/node counts |
| Error   | Hierarchical pipeline errors are caught and reported with recovery actions; flat pipeline errors handled as before |
| Empty   | Zero notes → both pipelines skip gracefully, same as today |
| Success | Both flat and hierarchical stores populated; progress detail includes tree/node/summary counts |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/indexing.hierarchicalReindex.test.ts` | Unit tests for the hierarchical full reindex pipeline: tree building, node storage, summary generation, embedding, progress stages |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/IndexingService.ts` | Add `summaryService` and `hierarchicalStore` to `IndexingServiceDeps`; add hierarchical pipeline methods; update `runFullReindex` to call hierarchical pipeline alongside flat pipeline; update progress stages |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Pass `summaryService` and `hierarchicalStore` when constructing `IndexingService` |
| 3 | `src/__tests__/unit/indexing.reindex.test.ts` | Update `IndexingService` constructor calls to include new required deps (mock `summaryService` and `hierarchicalStore`) |
| 4 | `src/__tests__/integration/indexing.progress-flow.test.ts` | Update expected progress stage sequence to include Store and Summarize stages |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — `buildDocumentTree` already implemented in HIER-5
- `src/services/SummaryService.ts` — `generateSummaries` already implemented in SUM-1
- `src/storage/SqliteVecRepository.ts` — `HierarchicalStoreContract` already implemented in STOR-2
- `src/types.ts` — all required types already defined (HIER-1, SUM-1, INTG-1)
- `src/settings.ts` — token budget settings added in INTG-4 (not this story)
- `src/services/SearchService.ts` — retrieval changes are separate stories
- `src/main.ts` — no command or lifecycle changes
- `src/constants.ts` — no new constants needed

---

## 5. Acceptance Criteria Checklist

### Phase A: Dependency Wiring

- [x] **A1** — `IndexingServiceDeps` includes `summaryService` and `hierarchicalStore`
  - `summaryService` is typed as `SummaryServiceContract`. `hierarchicalStore` is typed as `HierarchicalStoreContract`. Both are required (not optional).
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::A1_deps_include_new_services(vitest)`

- [x] **A2** — Bootstrap passes `summaryService` and `hierarchicalStore` to `IndexingService`
  - `bootstrapRuntimeServices` constructs `IndexingService` with both new deps sourced from the service container.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::A2_bootstrap_passes_deps(vitest)`

### Phase B: Tree Building and Node Storage

- [x] **B1** — `runFullReindex` calls `buildDocumentTree()` for each crawled note
  - Each `ChunkerInput` is passed to `buildDocumentTree()` to produce a `HierarchicalChunkerResult` containing `tree` and `crossReferences`.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::B1_builds_document_trees(vitest)`

- [x] **B2** — Each document tree is stored via `hierarchicalStore.upsertNodeTree(tree)`
  - Called once per note's `DocumentTree`.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::B2_stores_node_trees(vitest)`

- [x] **B3** — Cross-references are stored via `hierarchicalStore.upsertCrossReferences(crossRefs)`
  - Called once per note with the `CrossReference[]` from `buildDocumentTree`.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::B3_stores_cross_references(vitest)`

- [x] **B4** — Tags are stored via `hierarchicalStore.upsertTags(nodeId, tags)` for each node
  - Called for every node in every tree that has a non-empty `tags` array.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::B4_stores_node_tags(vitest)`

### Phase C: Summary Generation

- [x] **C1** — `summaryService.generateSummaries(tree)` is called for each document tree
  - Called once per tree after the tree has been stored in the hierarchical store.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::C1_generates_summaries(vitest)`

- [x] **C2** — Summary generation errors for individual trees do not abort the entire reindex
  - If `generateSummaries` throws for one tree, the error is logged and the pipeline continues with remaining trees. The final snapshot includes a warning about partial summary failures.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::C2_summary_error_non_fatal(vitest)`

### Phase D: Hierarchical Embedding

- [x] **D1** — Leaf nodes (paragraph, bullet) are embedded with `EmbeddingType = "content"`
  - For each leaf node, `embeddingService.embed()` is called with the node's `content` text, and the resulting vector is stored via `hierarchicalStore.upsertEmbedding(nodeId, "content", vector)`.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::D1_embeds_leaf_content(vitest)`

- [x] **D2** — Non-leaf nodes (note, topic, subtopic, bullet_group) are embedded with `EmbeddingType = "summary"`
  - For each non-leaf node that has a summary in the store, `embeddingService.embed()` is called with the summary text, and the resulting vector is stored via `hierarchicalStore.upsertEmbedding(nodeId, "summary", vector)`.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::D2_embeds_non_leaf_summaries(vitest)`

- [x] **D3** — Embedding uses the same provider and model settings as the flat pipeline
  - `settings.embeddingProvider` and `settings.embeddingModel` are used for all hierarchical embedding calls.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::D3_uses_configured_embedding_settings(vitest)`

- [x] **D4** — Embedding errors are handled with recovery guidance
  - If embedding fails for a batch, the error message includes a recovery action consistent with the existing `withRecoveryAction` pattern.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::D4_embedding_error_recovery(vitest)`

### Phase E: Progress Stages

- [x] **E1** — Progress stages follow the sequence: Crawl → Chunk → Store → Summarize → Embed → Finalize
  - The `onProgress` callback receives snapshots with labels containing each stage name in order.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::E1_progress_stage_order(vitest)`

- [x] **E2** — "Store" stage reports the number of trees being stored
  - The progress detail includes the count of document trees (one per note).
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::E2_store_stage_detail(vitest)`

- [x] **E3** — "Summarize" stage reports summary generation progress
  - The progress detail includes the count of trees being summarized.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::E3_summarize_stage_detail(vitest)`

- [x] **E4** — "Embed" stage reports the total number of nodes being embedded
  - The progress detail includes the count of nodes (leaf + non-leaf with summaries) being embedded.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::E4_embed_stage_detail(vitest)`

### Phase F: Flat Pipeline Preservation

- [x] **F1** — The flat pipeline (`chunkMarkdownNote` → `vectorStoreRepository.replaceAllFromChunks`) still runs
  - Both flat and hierarchical pipelines execute during `runFullReindex`. The flat pipeline produces `ChunkRecord[]` and stores them via `vectorStoreRepository` as before.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::F1_flat_pipeline_preserved(vitest)`

- [x] **F2** — Existing flat reindex tests continue to pass
  - The tests in `src/__tests__/unit/indexing.reindex.test.ts` pass with updated constructor calls (new deps are mocked).
  - Evidence: `src/__tests__/unit/indexing.reindex.test.ts` — all existing tests pass

- [x] **F3** — Existing progress integration test updated for new stage sequence
  - The test in `src/__tests__/integration/indexing.progress-flow.test.ts` is updated to expect the new stage sequence (Crawl → Chunk → Store → Summarize → Embed → Finalize).
  - Evidence: `src/__tests__/integration/indexing.progress-flow.test.ts` — updated and passing

### Phase G: Empty Vault Edge Case

- [x] **G1** — Zero notes produces a clean success snapshot with no hierarchical calls
  - When `crawlNotesForIndexing` returns an empty array, no calls are made to `buildDocumentTree`, `hierarchicalStore`, `summaryService`, or hierarchical embedding. The success snapshot reports 0 notes.
  - Evidence: `src/__tests__/unit/indexing.hierarchicalReindex.test.ts::G1_empty_vault_no_hierarchical_calls(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Running both flat and hierarchical pipelines doubles indexing time and storage | This is a transitional state. The flat pipeline will be removed once the retrieval layer is fully switched to hierarchical search. The dual-write ensures no regression in the existing search/chat experience. |
| 2 | Summary generation adds LLM calls per note, increasing indexing latency and cost | Summary generation uses the chat model with `max_tokens` capped at ~100 per call. Leaf nodes below ~200 tokens are skipped. Per-tree errors are non-fatal to avoid blocking the entire reindex. |
| 3 | Embedding both content and summary vectors doubles the embedding API calls | Embeddings are batched where possible. The hierarchical embedding step reuses the same `embeddingService.embed()` with the same batching/retry logic already hardened in STO-6. |
| 4 | `IndexingServiceDeps` grows from 6 to 8 fields | The deps interface is internal and only constructed in bootstrap. The two new fields align with the service container's existing wiring. |
| 5 | Progress stage count increases from 4 to 6, which may affect progress UI assumptions | The `ProgressSlideout` already handles dynamic stage labels via `JobSnapshot.progress.label`. No UI changes are needed — the slideout will display the new stage names automatically. |
| 6 | A failure in the hierarchical pipeline (store/summarize/embed) could leave partial data | Each step is idempotent: `upsertNodeTree` replaces existing data, `upsertEmbedding` overwrites. A subsequent reindex will produce a clean state. Summary errors for individual trees are logged and skipped. |

---

## Implementation Order

1. `src/services/IndexingService.ts` — Add `summaryService: SummaryServiceContract` and `hierarchicalStore: HierarchicalStoreContract` to `IndexingServiceDeps` (covers A1)
2. `src/services/IndexingService.ts` — Add import for `buildDocumentTree` and `HierarchicalChunkerResult` from `src/utils/chunker.ts`; add imports for `DocumentTree`, `CrossReference`, `EmbeddingType`, `SummaryServiceContract`, `HierarchicalStoreContract` from `src/types.ts`
3. `src/services/IndexingService.ts` — Add private helper methods: `buildAndStoreDocumentTrees()` (builds trees, stores nodes/tags/cross-refs), `generateTreeSummaries()` (calls summaryService per tree), `embedHierarchicalNodes()` (embeds leaf content + non-leaf summaries) (covers B1–B4, C1–C2, D1–D4)
4. `src/services/IndexingService.ts` — Update `runFullReindex()` to call the new helper methods in sequence after the flat pipeline, with progress emissions for Store, Summarize, and Embed stages (covers E1–E4, F1, G1)
5. `src/bootstrap/bootstrapRuntimeServices.ts` — Pass `summaryService` and `hierarchicalStore` from the service container to `IndexingService` constructor (covers A2)
6. `src/__tests__/unit/indexing.reindex.test.ts` — Update `IndexingService` constructor calls to include mocked `summaryService` and `hierarchicalStore` (covers F2)
7. `src/__tests__/integration/indexing.progress-flow.test.ts` — Update expected progress stage assertions for new stage sequence (covers F3)
8. `src/__tests__/unit/indexing.hierarchicalReindex.test.ts` — Write comprehensive tests for all acceptance criteria A1–G1
9. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z3)

---

*Created: 2026-03-22 | Story: INTG-2 | Epic: Epic 15 — Hierarchical Indexing Pipeline Integration*
