# INTG-3: Update IndexingService for hierarchical incremental index

**Story**: Add hierarchical incremental indexing to `runIncrementalIndex` so that changed notes are re-chunked into document trees, stale hierarchical data is deleted, new trees are stored, incremental summary propagation runs, and changed content + summaries are re-embedded.
**Epic**: Epic 15 — Hierarchical Indexing Pipeline Integration
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story extends the `runIncrementalIndex` method in `IndexingService` to use the hierarchical document model alongside the existing flat pipeline. After INTG-2, `runFullReindex` already runs both flat and hierarchical pipelines in parallel, but `runIncrementalIndex` still only uses the flat pipeline: it loads the previous manifest, computes a diff (created/updated/deleted), chunks changed notes with `chunkMarkdownNote()`, embeds chunks, deletes stale note paths, upserts new chunks, and saves the updated manifest.

After this story, `runIncrementalIndex` will additionally: (1) build document trees for changed/created notes via `buildDocumentTree()`, (2) delete stale hierarchical data for changed/deleted notes via `hierarchicalStore.deleteByNotePath()`, (3) store new trees via `hierarchicalStore.upsertNodeTree(tree)` plus tags and cross-references, (4) trigger incremental summary propagation via `summaryService.propagateSummariesForChangedNodes(changedNodeIds)` which regenerates summaries from changed nodes up through ancestors, and (5) re-embed changed content and summaries using the same embedding logic established in INTG-2.

The incremental hierarchical pipeline is more nuanced than the full reindex pipeline because it must identify which specific nodes changed (not just which notes changed), propagate summaries only through affected ancestor chains, and re-embed only the affected nodes. The `hierarchicalStore.getNodesByNotePath()` method is used to retrieve existing nodes for a note before deletion, enabling collection of changed node IDs for summary propagation. The progress stage sequence for incremental indexing becomes: Crawl → Chunk → Store → Summarize → Embed → Finalize, matching the full reindex stage sequence from INTG-2.

The flat pipeline is retained alongside the hierarchical pipeline, consistent with the dual-write strategy established in INTG-2. Both pipelines will run until the retrieval layer is fully switched to hierarchical search in later stories.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The `IndexingServiceDeps` interface is unchanged from INTG-2:

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

Key method signatures consumed by the incremental hierarchical pipeline:

```ts
// From src/utils/chunker.ts
buildDocumentTree(input: ChunkerInput, options?: HierarchicalChunkerOptions): HierarchicalChunkerResult
// where HierarchicalChunkerResult = { tree: DocumentTree; crossReferences: CrossReference[] }

// From SummaryServiceContract
propagateSummariesForChangedNodes(changedNodeIds: string[]): Promise<{ nodeId: string; skipped: boolean; error?: string }[]>

// From HierarchicalStoreContract
deleteByNotePath(notePath: string): Promise<void>
getNodesByNotePath(notePath: string): Promise<DocumentNode[]>
upsertNodeTree(tree: DocumentTree): Promise<void>
upsertCrossReferences(refs: CrossReference[]): Promise<void>
upsertTags(nodeId: string, tags: string[]): Promise<void>
upsertEmbedding(nodeId: string, embeddingType: EmbeddingType, vector: EmbeddingVector): Promise<void>
getSummary(nodeId: string): Promise<SummaryRecord | null>
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created. The changes are entirely within the service layer:

```
src/services/IndexingService.ts (modified)
├── runIncrementalIndex() — adds hierarchical pipeline alongside flat pipeline
├── Reuses: storeHierarchicalTrees() — from INTG-2
├── Reuses: collectEmbeddableNodes() — from INTG-2
├── Reuses: embedHierarchicalNodes() — from INTG-2
└── New incremental-specific logic:
    ├── getNodesByNotePath() — collect existing node IDs before deletion
    ├── deleteByNotePath() — remove stale hierarchical data
    ├── buildDocumentTree() — rebuild trees for changed notes
    └── propagateSummariesForChangedNodes() — incremental summary propagation

src/__tests__/unit/indexing.incrementalHierarchical.test.ts (new)
└── Tests for hierarchical incremental index pipeline
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `runIncrementalIndex` | Same params, extended internal pipeline | N/A | Adds hierarchical steps after flat pipeline |
| Progress stages | Crawl → Chunk → Store → Summarize → Embed → Finalize | N/A | Matches full reindex stage sequence from INTG-2 |
| `propagateSummariesForChangedNodes` | `(changedNodeIds: string[]) => Promise<SummaryGenerationResult[]>` | Stateless per call | Regenerates summaries from changed nodes up through ancestors |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Progress slideout shows incremental stages (Store, Summarize, Embed) with changed note/node counts |
| Error   | Hierarchical pipeline errors are caught and reported with recovery actions; flat pipeline errors handled as before |
| Empty   | Zero changes detected → both pipelines skip gracefully, no hierarchical calls made |
| Success | Both flat and hierarchical stores updated for changed notes; progress detail includes changed/created/deleted counts |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/indexing.incrementalHierarchical.test.ts` | Unit tests for the hierarchical incremental index pipeline: tree building for changed notes, stale data deletion, node storage, summary propagation, embedding, progress stages, edge cases |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/IndexingService.ts` | Update `runIncrementalIndex` to add hierarchical pipeline: collect existing node IDs, delete stale hierarchical data, build trees for changed notes, store trees/tags/cross-refs, propagate summaries, embed changed nodes; update progress stages to Crawl → Chunk → Store → Summarize → Embed → Finalize |
| 2 | `src/__tests__/unit/indexing.reindex.test.ts` | Update incremental index tests (if any exist in this file) to account for new progress stage sequence |
| 3 | `src/__tests__/integration/indexing.progress-flow.test.ts` | Update expected incremental progress stage sequence to include Store, Summarize, and Embed stages |

### Files UNCHANGED (confirm no modifications needed)

- `src/bootstrap/bootstrapRuntimeServices.ts` — deps already wired in INTG-2; no new deps needed
- `src/utils/chunker.ts` — `buildDocumentTree` already implemented in HIER-5
- `src/services/SummaryService.ts` — `propagateSummariesForChangedNodes` already implemented in SUM-2
- `src/storage/SqliteVecRepository.ts` — `HierarchicalStoreContract` already implemented in STOR-2
- `src/types.ts` — all required types already defined
- `src/settings.ts` — no new settings needed
- `src/services/SearchService.ts` — retrieval changes are separate stories
- `src/main.ts` — no command or lifecycle changes
- `src/constants.ts` — no new constants needed
- `src/__tests__/unit/indexing.hierarchicalReindex.test.ts` — INTG-2 full reindex tests remain unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Hierarchical Data Cleanup for Changed/Deleted Notes

- [x] **A1** — Existing hierarchical nodes are collected before deletion for changed notes
  - For each note in the `updated` diff category, `hierarchicalStore.getNodesByNotePath(notePath)` is called to retrieve existing node IDs before the note's hierarchical data is deleted. These node IDs are collected for summary propagation.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::A1_collects_existing_node_ids(vitest)`

- [x] **A2** — Stale hierarchical data is deleted for changed and deleted notes
  - `hierarchicalStore.deleteByNotePath(notePath)` is called for every note path in the union of `diff.updated` and `diff.deleted`. This removes all nodes, summaries, embeddings, tags, and cross-references for those notes.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::A2_deletes_stale_hierarchical_data(vitest)`

- [x] **A3** — Deleted notes do not trigger tree building
  - Notes that appear only in `diff.deleted` (not in `diff.created` or `diff.updated`) have their hierarchical data deleted but no new tree is built for them.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::A3_deleted_notes_no_tree_build(vitest)`

### Phase B: Tree Building and Node Storage for Changed Notes

- [x] **B1** — `buildDocumentTree()` is called for each created/updated note
  - Each `ChunkerInput` for notes in `diff.created` and `diff.updated` is passed to `buildDocumentTree()` to produce a `HierarchicalChunkerResult` containing `tree` and `crossReferences`.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::B1_builds_trees_for_changed_notes(vitest)`

- [x] **B2** — Each document tree is stored via `hierarchicalStore.upsertNodeTree(tree)`
  - Called once per changed note's `DocumentTree`.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::B2_stores_node_trees(vitest)`

- [x] **B3** — Cross-references are stored via `hierarchicalStore.upsertCrossReferences(crossRefs)`
  - Called once per changed note with the `CrossReference[]` from `buildDocumentTree`.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::B3_stores_cross_references(vitest)`

- [x] **B4** — Tags are stored via `hierarchicalStore.upsertTags(nodeId, tags)` for each node with tags
  - Called for every node in every changed note's tree that has a non-empty `tags` array.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::B4_stores_node_tags(vitest)`

### Phase C: Incremental Summary Propagation

- [x] **C1** — `summaryService.propagateSummariesForChangedNodes(changedNodeIds)` is called with collected node IDs
  - The `changedNodeIds` argument includes the node IDs from the newly built trees for created/updated notes. This triggers bottom-up summary regeneration from changed nodes through their ancestors.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::C1_propagates_summaries(vitest)`

- [x] **C2** — Summary propagation errors are non-fatal
  - If `propagateSummariesForChangedNodes` throws, the error is logged and the pipeline continues. The final snapshot does not fail due to summary propagation errors alone.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::C2_summary_propagation_error_non_fatal(vitest)`

- [x] **C3** — Empty changed node list skips summary propagation
  - When no notes have changed (all unchanged), `propagateSummariesForChangedNodes` is not called.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::C3_no_changes_skips_propagation(vitest)`

### Phase D: Hierarchical Embedding for Changed Nodes

- [x] **D1** — Leaf nodes from changed notes are embedded with `EmbeddingType = "content"`
  - For each leaf node (paragraph, bullet) in the newly built trees, `embeddingService.embed()` is called with the node's `content` text, and the resulting vector is stored via `hierarchicalStore.upsertEmbedding(nodeId, "content", vector)`.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::D1_embeds_leaf_content(vitest)`

- [x] **D2** — Non-leaf nodes from changed notes are embedded with `EmbeddingType = "summary"`
  - For each non-leaf node (note, topic, subtopic, bullet_group) that has a summary in the store after propagation, `embeddingService.embed()` is called with the summary text, and the resulting vector is stored via `hierarchicalStore.upsertEmbedding(nodeId, "summary", vector)`.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::D2_embeds_non_leaf_summaries(vitest)`

- [x] **D3** — Hierarchical embedding errors include recovery guidance
  - If embedding fails, the error message includes a recovery action consistent with the `withRecoveryAction` pattern, recommending retry or full reindex.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::D3_embedding_error_recovery(vitest)`

### Phase E: Progress Stages

- [x] **E1** — Incremental progress stages follow the sequence: Crawl → Chunk → Store → Summarize → Embed → Finalize
  - The `onProgress` callback receives snapshots with labels containing each stage name in order, matching the full reindex stage sequence from INTG-2.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::E1_progress_stage_order(vitest)`

- [x] **E2** — "Store" stage reports the number of changed trees being stored
  - The progress detail includes the count of document trees for changed notes.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::E2_store_stage_detail(vitest)`

- [x] **E3** — "Summarize" stage reports summary propagation progress
  - The progress detail includes the count of changed node IDs being propagated.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::E3_summarize_stage_detail(vitest)`

- [x] **E4** — "Embed" stage reports the total number of nodes being embedded
  - The progress detail includes the count of embeddable nodes (leaf + non-leaf with summaries) from changed trees, alongside the flat chunk count.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::E4_embed_stage_detail(vitest)`

### Phase F: Flat Pipeline Preservation

- [x] **F1** — The flat incremental pipeline still runs alongside the hierarchical pipeline
  - The existing flat pipeline (`chunkMarkdownNote` → `vectorStoreRepository.deleteByNotePaths` → `vectorStoreRepository.upsertFromChunks`) continues to execute for changed notes. Both flat and hierarchical pipelines produce results during incremental indexing.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::F1_flat_pipeline_preserved(vitest)`

- [x] **F2** — Existing flat incremental index tests continue to pass
  - The tests in `src/__tests__/unit/indexing.reindex.test.ts` pass without modification (mocked deps already include `summaryService` and `hierarchicalStore`).
  - Evidence: `src/__tests__/unit/indexing.reindex.test.ts` — all existing tests pass

- [x] **F3** — Existing progress integration test updated for incremental stage sequence
  - The test in `src/__tests__/integration/indexing.progress-flow.test.ts` is updated to expect the new incremental stage sequence (Crawl → Chunk → Store → Summarize → Embed → Finalize).
  - Evidence: `src/__tests__/integration/indexing.progress-flow.test.ts` — updated and passing

### Phase G: Edge Cases

- [x] **G1** — Zero changes detected produces a clean success snapshot with no hierarchical calls
  - When the diff shows no created, updated, or deleted notes, no calls are made to `buildDocumentTree`, `hierarchicalStore.deleteByNotePath`, `summaryService.propagateSummariesForChangedNodes`, or hierarchical embedding. The success snapshot reports "No changes detected."
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::G1_no_changes_no_hierarchical_calls(vitest)`

- [x] **G2** — Only deleted notes (no created/updated) cleans up hierarchical data without building trees
  - When only deletions are detected, `hierarchicalStore.deleteByNotePath` is called for each deleted note, but `buildDocumentTree` and `summaryService.propagateSummariesForChangedNodes` are not called.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::G2_only_deletes_cleanup_only(vitest)`

- [x] **G3** — Baseline fallback from incremental still uses flat-only pipeline
  - When consistency preflight requires a full reindex baseline (via `runBaselineFromIncremental`), the hierarchical incremental pipeline is not invoked. The baseline fallback path remains flat-only as established in IDX-4.
  - Evidence: `src/__tests__/unit/indexing.incrementalHierarchical.test.ts::G3_baseline_fallback_flat_only(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Running both flat and hierarchical incremental pipelines doubles the per-change indexing time | This is a transitional state. The flat pipeline will be removed once the retrieval layer is fully switched to hierarchical search. The dual-write ensures no regression in the existing search/chat experience. |
| 2 | Collecting existing node IDs via `getNodesByNotePath` before deletion adds a read per changed note | This read is necessary to identify which node IDs changed for summary propagation. The read is a simple index scan on `note_path` and is fast even for large trees. |
| 3 | Summary propagation adds LLM calls for ancestor nodes, increasing incremental indexing latency | Propagation is bounded: only changed nodes and their ancestors (not the entire tree) get new summaries. Deduplication in `propagateSummariesForChangedNodes` avoids redundant LLM calls when multiple nodes share ancestors. Per-node errors are non-fatal. |
| 4 | Embedding both content and summary vectors for changed nodes doubles the embedding API calls for those notes | Only changed notes are re-embedded, not the entire vault. The hierarchical embedding step reuses the same `embeddingService.embed()` with the same batching/retry logic already hardened in STO-6. |
| 5 | Deleting all hierarchical data for a note before re-storing loses the ability to diff at the node level | A full delete-and-replace per note is simpler and more reliable than node-level diffing. The `upsertNodeTree` call is idempotent. Node-level diffing can be added as a future optimization if incremental indexing latency becomes a concern for large notes. |
| 6 | The baseline fallback path (`runBaselineFromIncremental`) does not include hierarchical pipeline | This is intentional. The baseline fallback is a recovery mechanism that rebuilds a clean flat baseline. Users can run a full reindex to also rebuild the hierarchical store. Adding hierarchical support to the baseline fallback would increase complexity for a rare recovery path. |

---

## Implementation Order

1. `src/services/IndexingService.ts` — Update `runIncrementalIndex` to add hierarchical data cleanup: for each note in `diff.updated`, call `hierarchicalStore.getNodesByNotePath()` to collect existing node IDs, then call `hierarchicalStore.deleteByNotePath()` for all updated + deleted note paths (covers A1, A2, A3)
2. `src/services/IndexingService.ts` — Add tree building for changed notes: call `buildDocumentTree()` for each created/updated note, then call `storeHierarchicalTrees()` (reuse from INTG-2) to store trees/tags/cross-refs (covers B1–B4)
3. `src/services/IndexingService.ts` — Add incremental summary propagation: collect all node IDs from newly built trees, call `summaryService.propagateSummariesForChangedNodes(changedNodeIds)` with error handling (covers C1–C3)
4. `src/services/IndexingService.ts` — Add hierarchical embedding for changed nodes: call `collectEmbeddableNodes()` and `embedHierarchicalNodes()` (reuse from INTG-2) for the changed trees (covers D1–D3)
5. `src/services/IndexingService.ts` — Update progress stage emissions in `runIncrementalIndex` to include Store, Summarize, and Embed stages between Chunk and Finalize (covers E1–E4)
6. **Verify** — `npm run typecheck && npm run build`
7. `src/__tests__/integration/indexing.progress-flow.test.ts` — Update expected incremental progress stage assertions for new stage sequence (covers F3)
8. `src/__tests__/unit/indexing.incrementalHierarchical.test.ts` — Write comprehensive tests for all acceptance criteria A1–G3
9. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: INTG-3 | Epic: Epic 15 — Hierarchical Indexing Pipeline Integration*
