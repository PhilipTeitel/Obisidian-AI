# STOR-2: Implement SqliteVecRepository with HierarchicalStoreContract

**Story**: Implement `SqliteVecRepository` in `src/storage/SqliteVecRepository.ts` that implements the `HierarchicalStoreContract` interface using an in-memory storage backend compatible with the hierarchical schema defined in STOR-1.
**Epic**: Epic 12 — SQLite Hierarchical Storage Migration
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story creates the `SqliteVecRepository` class that implements the `HierarchicalStoreContract` interface defined in HIER-1. The repository provides all tree traversal queries, summary/content embedding search, upsert/delete operations, tag queries, and cross-reference management needed by the hierarchical indexing pipeline.

The implementation uses an in-memory storage approach that mirrors the relational schema defined in STOR-1's migration. Internally, the repository maintains `Map`-based collections for nodes, children relationships, summaries, embeddings, tags, and cross-references. This approach is consistent with the existing `LocalVectorStoreRepository` pattern (which also uses in-memory storage with `plugin.loadData()`/`saveData()` persistence) and ensures the repository is fully testable in Vitest's Node.js environment without requiring wa-SQLite WASM binaries.

The repository implements the `RuntimeServiceLifecycle` interface (`init()`/`dispose()`) so it can be managed by the bootstrap system. It includes structured logging for all storage operations following the project's logging conventions.

Key implementation details:
- **Tree traversal**: `getChildren` returns ordered children via the `node_children` sort_order. `getAncestorChain` walks up via `parent_id` to root. `getSiblings` finds all children of the same parent.
- **Embedding search**: `searchSummaryEmbeddings` and `searchContentEmbeddings` perform brute-force cosine similarity search over the appropriate embedding type, with optional parent scoping for drill-down queries.
- **Upsert semantics**: `upsertNodeTree` replaces all nodes for a given note path (delete-then-insert). Individual `upsertSummary`, `upsertEmbedding`, `upsertTags`, and `upsertCrossReferences` operations use insert-or-replace semantics.
- **Persistence**: The repository persists state via `plugin.loadData()`/`saveData()` under a `hierarchicalStore` key, separate from the existing `vectorStore` key used by `LocalVectorStoreRepository`.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The `SqliteVecRepository` class signature:

```ts
import type {
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingType,
  EmbeddingVector,
  HierarchicalStoreContract,
  NodeMatch,
  RuntimeBootstrapContext,
  RuntimeServiceLifecycle,
  SummaryRecord
} from "../types";

export interface SqliteVecRepositoryDeps {
  plugin: RuntimeBootstrapContext["plugin"];
  pluginId: string;
}

export class SqliteVecRepository implements HierarchicalStoreContract, RuntimeServiceLifecycle {
  constructor(deps: SqliteVecRepositoryDeps);

  // RuntimeServiceLifecycle
  init(): Promise<void>;
  dispose(): Promise<void>;

  // HierarchicalStoreContract
  upsertNodeTree(tree: DocumentTree): Promise<void>;
  deleteByNotePath(notePath: string): Promise<void>;
  getNode(nodeId: string): Promise<DocumentNode | null>;
  getChildren(nodeId: string): Promise<DocumentNode[]>;
  getAncestorChain(nodeId: string): Promise<DocumentNode[]>;
  getSiblings(nodeId: string): Promise<DocumentNode[]>;
  getNodesByNotePath(notePath: string): Promise<DocumentNode[]>;
  searchSummaryEmbeddings(vector: EmbeddingVector, topK: number): Promise<NodeMatch[]>;
  searchContentEmbeddings(vector: EmbeddingVector, topK: number, parentId?: string): Promise<NodeMatch[]>;
  upsertSummary(nodeId: string, summary: SummaryRecord): Promise<void>;
  getSummary(nodeId: string): Promise<SummaryRecord | null>;
  upsertEmbedding(nodeId: string, embeddingType: EmbeddingType, vector: EmbeddingVector): Promise<void>;
  upsertTags(nodeId: string, tags: string[]): Promise<void>;
  upsertCrossReferences(refs: CrossReference[]): Promise<void>;
  getCrossReferences(nodeId: string): Promise<CrossReference[]>;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created or modified in this story. The repository is consumed by service-layer code:

```
src/storage/SqliteVecRepository.ts (new)
├── STOR-3: bootstrapRuntimeServices.ts constructs and wires the repository
├── INTG-2: IndexingService uses upsertNodeTree, deleteByNotePath
├── SUM-1: SummaryService uses upsertSummary, getSummary
├── RET-1: SearchService uses searchSummaryEmbeddings
├── RET-2: SearchService uses searchContentEmbeddings
├── RET-3: ContextAssemblyService uses getAncestorChain, getSiblings, getChildren
└── META-1/2: Tag and cross-reference queries
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SqliteVecRepository` | `SqliteVecRepositoryDeps` | In-memory Maps | Implements `HierarchicalStoreContract` + `RuntimeServiceLifecycle` |
| `upsertNodeTree` | `(tree: DocumentTree) => Promise<void>` | Mutates internal state | Delete-then-insert for the note path |
| `searchSummaryEmbeddings` | `(vector, topK) => Promise<NodeMatch[]>` | Read-only | Cosine similarity over summary embeddings |
| `searchContentEmbeddings` | `(vector, topK, parentId?) => Promise<NodeMatch[]>` | Read-only | Cosine similarity over content embeddings, optionally scoped |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | `init()` loads persisted state from plugin data |
| Error   | Errors are normalized via `normalizeRuntimeError` and logged |
| Empty   | Empty state is valid — no nodes, no embeddings |
| Success | All operations complete and persist state |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/SqliteVecRepository.ts` | `HierarchicalStoreContract` + `RuntimeServiceLifecycle` implementation |
| 2 | `src/__tests__/unit/sqliteVecRepository.test.ts` | Comprehensive unit tests for all contract methods |

### Files to MODIFY

None.

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — `HierarchicalStoreContract` already defined by HIER-1
- `src/storage/vectorStoreSchema.ts` — migration defined by STOR-1; not executed by this repository
- `src/storage/LocalVectorStoreRepository.ts` — existing flat store remains functional
- `src/bootstrap/bootstrapRuntimeServices.ts` — wiring happens in STOR-3
- `src/services/IndexingService.ts` — integration happens in INTG-2

---

## 5. Acceptance Criteria Checklist

### Phase A: Repository Structure and Lifecycle

- [x] **A1** — `SqliteVecRepository` class exists and implements `HierarchicalStoreContract`
  - The class is exported from `src/storage/SqliteVecRepository.ts`.
  - TypeScript compilation confirms it satisfies the `HierarchicalStoreContract` interface.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::A1_implements_contract(vitest)`

- [x] **A2** — `SqliteVecRepository` implements `RuntimeServiceLifecycle`
  - The class has `init()` and `dispose()` methods.
  - `init()` loads persisted state. `dispose()` is a clean no-op.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::A2_lifecycle_init_dispose(vitest)`

### Phase B: Node Tree Operations

- [x] **B1** — `upsertNodeTree` stores all nodes from a `DocumentTree`
  - After upserting a tree, `getNode` returns each node by ID.
  - `getNodesByNotePath` returns all nodes for the note.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::B1_upsert_and_get_nodes(vitest)`

- [x] **B2** — `upsertNodeTree` replaces existing nodes for the same note path
  - Upserting a tree for a note path that already has nodes replaces all old nodes.
  - Old nodes are no longer returned by `getNode` or `getNodesByNotePath`.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::B2_upsert_replaces_existing(vitest)`

- [x] **B3** — `deleteByNotePath` removes all nodes, summaries, embeddings, tags, and cross-refs for a note
  - After deletion, `getNodesByNotePath` returns an empty array.
  - Associated summaries, embeddings, tags, and cross-references are also removed.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::B3_delete_by_note_path(vitest)`

### Phase C: Tree Traversal

- [x] **C1** — `getChildren` returns ordered children of a node
  - Children are returned in `sort_order` (matching `sequenceIndex`).
  - Returns an empty array for leaf nodes.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::C1_get_children_ordered(vitest)`

- [x] **C2** — `getAncestorChain` walks from a node to the root
  - Returns an array starting with the immediate parent and ending with the root node.
  - Returns an empty array for the root node itself.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::C2_ancestor_chain_to_root(vitest)`

- [x] **C3** — `getSiblings` returns all children of the same parent, ordered
  - Includes the queried node itself in the result.
  - Returns only the queried node if it has no siblings.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::C3_get_siblings(vitest)`

### Phase D: Embedding Search

- [x] **D1** — `searchSummaryEmbeddings` returns top-K matches from summary embeddings only
  - Only embeddings with `embeddingType: "summary"` are searched.
  - Results are ordered by descending cosine similarity score.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::D1_search_summary_embeddings(vitest)`

- [x] **D2** — `searchContentEmbeddings` returns top-K matches from content embeddings
  - Only embeddings with `embeddingType: "content"` are searched.
  - Results are ordered by descending cosine similarity score.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::D2_search_content_embeddings(vitest)`

- [x] **D3** — `searchContentEmbeddings` with `parentId` scopes search to children of that parent
  - When `parentId` is provided, only embeddings for nodes whose `parentId` matches are searched.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::D3_scoped_content_search(vitest)`

### Phase E: Summary Operations

- [x] **E1** — `upsertSummary` stores and `getSummary` retrieves a summary record
  - The summary includes all provenance fields: `nodeId`, `summary`, `modelUsed`, `promptVersion`, `generatedAt`.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::E1_upsert_get_summary(vitest)`

- [x] **E2** — `upsertSummary` replaces an existing summary for the same node
  - A second upsert with different content overwrites the first.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::E2_summary_upsert_replaces(vitest)`

### Phase F: Tag and Cross-Reference Operations

- [x] **F1** — `upsertTags` stores tags and they are queryable
  - Tags are stored for a node and can be verified via the node's stored data.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::F1_upsert_tags(vitest)`

- [x] **F2** — `upsertCrossReferences` stores and `getCrossReferences` retrieves cross-refs
  - Cross-references include `sourceNodeId`, `targetPath`, and `targetDisplay`.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::F2_cross_references(vitest)`

### Phase G: Structured Logging

- [x] **G1** — All storage operations emit structured log events
  - Operations log start/completion with timing data using `createRuntimeLogger`.
  - Evidence: `src/__tests__/unit/sqliteVecRepository.test.ts::G1_structured_logging(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | In-memory storage does not validate SQL syntax | SQL statements are validated by string inspection in STOR-1 tests. Full SQL execution will be validated when wa-SQLite is integrated at runtime. |
| 2 | Brute-force cosine similarity search is O(n) per query | Acceptable for MVP vault sizes (thousands of nodes). The wa-SQLite + sqlite-vec ANN index will provide better performance at runtime. |
| 3 | Persistence via `plugin.loadData()`/`saveData()` serializes Maps to JSON | Maps are converted to arrays for serialization and reconstructed on load. This matches the existing `LocalVectorStoreRepository` pattern. |
| 4 | Embedding vectors stored in memory could be large for big vaults | Acceptable for MVP. Future optimization: lazy loading or streaming from SQLite. |
| 5 | `upsertNodeTree` uses delete-then-insert which is not atomic | Acceptable for single-threaded Obsidian plugin. The operation completes before any other operation can run. |

---

## Implementation Order

1. `src/storage/SqliteVecRepository.ts` — Create class skeleton with constructor, `init()`, `dispose()`, and internal state types (covers A1, A2)
2. `src/storage/SqliteVecRepository.ts` — Implement `upsertNodeTree`, `deleteByNotePath`, `getNode`, `getNodesByNotePath` (covers B1, B2, B3)
3. `src/storage/SqliteVecRepository.ts` — Implement `getChildren`, `getAncestorChain`, `getSiblings` (covers C1, C2, C3)
4. `src/storage/SqliteVecRepository.ts` — Implement `searchSummaryEmbeddings`, `searchContentEmbeddings` with cosine similarity (covers D1, D2, D3)
5. `src/storage/SqliteVecRepository.ts` — Implement `upsertSummary`, `getSummary` (covers E1, E2)
6. `src/storage/SqliteVecRepository.ts` — Implement `upsertEmbedding`, `upsertTags`, `upsertCrossReferences`, `getCrossReferences` (covers F1, F2)
7. `src/storage/SqliteVecRepository.ts` — Add structured logging for all operations (covers G1)
8. **Verify** — `npm run typecheck && npm run build` to confirm compilation
9. `src/__tests__/unit/sqliteVecRepository.test.ts` — Write comprehensive tests for all acceptance criteria (covers A1–G1)
10. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: STOR-2 | Epic: Epic 12 — SQLite Hierarchical Storage Migration*
