# HIER-1: Define hierarchical node types and HierarchicalStoreContract interface

**Story**: Define all hierarchical document-tree types (`DocumentNode`, `NodeType`, `DocumentTree`, summary/embedding records) and the `HierarchicalStoreContract` interface that downstream stories depend on.
**Epic**: Epic 11 — Hierarchical Document Model and Tree Chunker
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story introduces the foundational type system for the hierarchical document model described in requirement R1 of the hierarchical indexing specification. Every subsequent story in Epics 11–18 depends on the types and contract defined here: the tree chunker (HIER-5) produces `DocumentTree` instances, the SQLite repository (STOR-2) implements `HierarchicalStoreContract`, the summary service (SUM-1) consumes `DocumentNode` trees, and the retrieval pipeline (RET-1 through RET-5) operates on the same node/match/context types.

The types must model a tree of typed nodes per note (note → topic → subtopic → paragraph/bullet_group → bullet) with full metadata: stable IDs, parent/child relationships, heading trails, depth, content, sequence ordering, tags, and content hashes. In addition, the story defines record types for LLM-generated summaries (`SummaryRecord`) and embedding metadata (`EmbeddingType`, `NodeMatch`), as well as the assembled context types (`HierarchicalContextBlock`, `AssembledContext`) consumed by the retrieval and chat layers.

The guiding constraint is that these types are **additive** — the existing flat chunk types (`ChunkRecord`, `ChunkReference`, `VectorStoreRepositoryContract`, etc.) remain untouched so that the current pipeline continues to compile and run. The hierarchical types live alongside the flat types until the integration epic (Epic 15) switches the runtime over.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

All new types are added to `src/types.ts`. The following TypeScript interfaces must be added:

```ts
// ── Hierarchical Node Types (R1) ──────────────────────────────────────

export type NodeType = "note" | "topic" | "subtopic" | "paragraph" | "bullet_group" | "bullet";

export interface DocumentNode {
  nodeId: string;
  parentId: string | null;
  childIds: string[];
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  depth: number;
  nodeType: NodeType;
  content: string;
  sequenceIndex: number;
  tags: string[];
  contentHash: string;
  updatedAt: number;
}

export interface DocumentTree {
  root: DocumentNode;
  nodes: Map<string, DocumentNode>;
}

// ── Summary Types (R2) ────────────────────────────────────────────────

export interface SummaryRecord {
  nodeId: string;
  summary: string;
  modelUsed: string;
  promptVersion: string;
  generatedAt: number;
}

// ── Embedding Types (hierarchical) ───────────────────────────────────

export type EmbeddingType = "content" | "summary";

export interface NodeMatch {
  nodeId: string;
  score: number;
  embeddingType: EmbeddingType;
}

// ── Cross-Reference Types (R9) ───────────────────────────────────────

export interface CrossReference {
  sourceNodeId: string;
  targetPath: string;
  targetDisplay: string | null;
}

// ── Hierarchical Retrieval Types (R6, R7) ────────────────────────────

export interface LeafMatch {
  node: DocumentNode;
  score: number;
  ancestorChain: DocumentNode[];
}

export interface ContextTierUsage {
  matchedContentTokens: number;
  siblingContextTokens: number;
  parentSummaryTokens: number;
}

export interface HierarchicalContextBlock {
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  matchedContent: string;
  siblingContent: string;
  parentSummary: string;
  score: number;
}

export interface AssembledContext {
  blocks: HierarchicalContextBlock[];
  tierUsage: ContextTierUsage;
}

// ── Hierarchical Search Result ───────────────────────────────────────

export interface HierarchicalSearchResult {
  nodeId: string;
  score: number;
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  matchedContent: string;
  parentSummary: string;
  siblingSnippet: string;
  tags: string[];
}

// ── Indexing Stage Extension ─────────────────────────────────────────

// Extend IndexingStage to include 'summarize' stage:
// (updated union type)
```

The `HierarchicalStoreContract` interface must also be added to `src/types.ts`:

```ts
export interface HierarchicalStoreContract {
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

The `IndexingStage` union must be extended:

```ts
export type IndexingStage = "queued" | "crawl" | "chunk" | "summarize" | "embed" | "finalize";
```

The `RuntimeServices` interface must be extended to include the hierarchical store (but the actual implementation is wired in STOR-3/INTG-1):

```ts
export interface RuntimeServices {
  // ... existing services ...
  hierarchicalStore?: HierarchicalStoreContract;
  // ...
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created or modified in this story. The types defined here are consumed by backend services:

```
src/types.ts (new types)
├── HIER-5: chunker.ts produces DocumentTree
├── STOR-2: SqliteVecRepository implements HierarchicalStoreContract
├── SUM-1: SummaryService consumes DocumentNode trees, produces SummaryRecord
├── RET-1/2: SearchService uses NodeMatch, HierarchicalStoreContract
├── RET-3: ContextAssemblyService produces AssembledContext
├── RET-4: contextFormatter uses HierarchicalContextBlock
└── RET-5: ChatService uses HierarchicalSearchResult
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `DocumentNode` | Interface (data type) | N/A | Represents a single node in the document tree |
| `DocumentTree` | `{ root, nodes }` | N/A | Full tree for one note; `nodes` is a `Map` for O(1) lookup |
| `HierarchicalStoreContract` | 16 async methods | N/A | Storage contract for tree CRUD, search, and metadata |
| `SummaryRecord` | Interface (data type) | N/A | LLM-generated summary with provenance metadata |
| `HierarchicalContextBlock` | Interface (data type) | N/A | Single assembled context block for chat/search |
| `AssembledContext` | `{ blocks, tierUsage }` | N/A | Full assembled context with token budget tracking |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — this story defines types only |
| Error   | Not applicable |
| Empty   | Not applicable |
| Success | Not applicable |

No frontend work is required for this story. All types are consumed by service-layer code in subsequent stories.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/hierarchicalTypes.test.ts` | Compile-time contract tests verifying type shapes, `DocumentTree` construction, and `Map` semantics |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add all hierarchical node types, store contract, summary/embedding/context types, extend `IndexingStage`, add optional `hierarchicalStore` to `RuntimeServices` |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — the existing flat chunker is untouched; rewrite happens in HIER-5
- `src/storage/LocalVectorStoreRepository.ts` — existing flat store remains functional
- `src/storage/vectorStoreSchema.ts` — schema migration is STOR-1
- `src/bootstrap/bootstrapRuntimeServices.ts` — wiring happens in STOR-3/INTG-1
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/services/SearchService.ts` — retrieval changes happen in RET-1/RET-2
- `src/settings.ts` — token budget settings added in INTG-4
- `src/main.ts` — no command or lifecycle changes
- `src/constants.ts` — no new constants needed

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Node Types

- [x] **A1** — `NodeType` union type is defined with all six values
  - The type `NodeType` must be a string literal union: `"note" | "topic" | "subtopic" | "paragraph" | "bullet_group" | "bullet"`.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::A1_node_type_union_values(vitest)`

- [x] **A2** — `DocumentNode` interface has all required fields
  - Must include: `nodeId`, `parentId` (nullable), `childIds` (string array), `notePath`, `noteTitle`, `headingTrail` (string array), `depth` (number), `nodeType` (NodeType), `content` (string), `sequenceIndex` (number), `tags` (string array), `contentHash` (string), `updatedAt` (number).
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::A2_document_node_fields(vitest)`

- [x] **A3** — `DocumentTree` interface contains `root` and `nodes` Map
  - `root` must be a `DocumentNode`. `nodes` must be `Map<string, DocumentNode>` for O(1) lookup by `nodeId`.
  - A `DocumentTree` can be constructed with a root node and its descendants in the map.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::A3_document_tree_construction(vitest)`

### Phase B: Summary, Embedding, and Cross-Reference Types

- [x] **B1** — `SummaryRecord` interface includes provenance fields
  - Must include: `nodeId`, `summary`, `modelUsed`, `promptVersion`, `generatedAt` (number/timestamp).
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::B1_summary_record_fields(vitest)`

- [x] **B2** — `EmbeddingType` and `NodeMatch` types are defined
  - `EmbeddingType` must be `"content" | "summary"`. `NodeMatch` must include `nodeId`, `score`, and `embeddingType`.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::B2_embedding_type_and_node_match(vitest)`

- [x] **B3** — `CrossReference` interface is defined
  - Must include `sourceNodeId`, `targetPath`, and `targetDisplay` (nullable string).
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::B3_cross_reference_fields(vitest)`

### Phase C: Retrieval and Context Assembly Types

- [x] **C1** — `LeafMatch` interface carries node, score, and ancestor chain
  - Must include `node` (DocumentNode), `score` (number), and `ancestorChain` (DocumentNode array).
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::C1_leaf_match_fields(vitest)`

- [x] **C2** — `HierarchicalContextBlock` and `AssembledContext` types are defined
  - `HierarchicalContextBlock` must include `notePath`, `noteTitle`, `headingTrail`, `matchedContent`, `siblingContent`, `parentSummary`, and `score`.
  - `AssembledContext` must include `blocks` (array of `HierarchicalContextBlock`) and `tierUsage` (`ContextTierUsage` with `matchedContentTokens`, `siblingContextTokens`, `parentSummaryTokens`).
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::C2_assembled_context_types(vitest)`

- [x] **C3** — `HierarchicalSearchResult` type is defined
  - Must include `nodeId`, `score`, `notePath`, `noteTitle`, `headingTrail`, `matchedContent`, `parentSummary`, `siblingSnippet`, and `tags`.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::C3_hierarchical_search_result_fields(vitest)`

### Phase D: HierarchicalStoreContract Interface

- [x] **D1** — `HierarchicalStoreContract` interface declares all required methods
  - Must declare: `upsertNodeTree`, `deleteByNotePath`, `getNode`, `getChildren`, `getAncestorChain`, `getSiblings`, `getNodesByNotePath`, `searchSummaryEmbeddings`, `searchContentEmbeddings`, `upsertSummary`, `getSummary`, `upsertEmbedding`, `upsertTags`, `upsertCrossReferences`, `getCrossReferences`.
  - Each method must have correct parameter types and return types as specified in Section 2.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::D1_store_contract_method_signatures(vitest)`

- [x] **D2** — `searchContentEmbeddings` accepts optional `parentId` for scoped search
  - The `parentId` parameter must be optional (used by Phase 2 drill-down to scope search to a parent node's children).
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::D2_scoped_content_search_signature(vitest)`

### Phase E: Integration with Existing Types

- [x] **E1** — `IndexingStage` union includes `"summarize"` stage
  - The updated type must be: `"queued" | "crawl" | "chunk" | "summarize" | "embed" | "finalize"`.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::E1_indexing_stage_includes_summarize(vitest)`

- [x] **E2** — `RuntimeServices` includes optional `hierarchicalStore` field
  - The `hierarchicalStore` field must be typed as `HierarchicalStoreContract | undefined` (optional) so existing bootstrap continues to work without it.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::E2_runtime_services_hierarchical_store(vitest)`

- [x] **E3** — Existing flat types remain unchanged and compile
  - `ChunkRecord`, `ChunkReference`, `VectorStoreRepositoryContract`, `VectorStoreRow`, `VectorStoreMatch`, `ChatContextChunk`, `SearchResult` must all remain present and unchanged.
  - Evidence: `src/__tests__/unit/hierarchicalTypes.test.ts::E3_existing_flat_types_unchanged(vitest)`

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
| 1 | Defining types too early may require revisions as implementation stories reveal edge cases | Types are designed to match the README architecture spec and R1-R9 requirements closely; any adjustments will be backward-compatible additions |
| 2 | `DocumentTree.nodes` using `Map<string, DocumentNode>` is not JSON-serializable | The `Map` is an in-memory runtime structure; serialization to SQLite uses the flat `nodes` table. Tests verify Map construction/lookup semantics |
| 3 | Adding `hierarchicalStore` as optional to `RuntimeServices` could mask missing wiring | The field is optional only during the transition period; INTG-1 will make it required when the bootstrap is updated |
| 4 | `childIds` array on `DocumentNode` duplicates the `node_children` table relationship | `childIds` is the in-memory representation for tree traversal; the DB table is the persistence layer. Both are needed for their respective contexts |
| 5 | Large number of new types in a single file (`types.ts`) could reduce readability | Types are organized into clearly commented sections with requirement references (R1, R2, R6, R7, R9). The file already follows this pattern for existing types |

---

## Implementation Order

1. `src/types.ts` — Add `NodeType` union and `DocumentNode` interface (covers A1, A2)
2. `src/types.ts` — Add `DocumentTree` interface (covers A3)
3. `src/types.ts` — Add `SummaryRecord`, `EmbeddingType`, `NodeMatch`, `CrossReference` (covers B1, B2, B3)
4. `src/types.ts` — Add `LeafMatch`, `ContextTierUsage`, `HierarchicalContextBlock`, `AssembledContext`, `HierarchicalSearchResult` (covers C1, C2, C3)
5. `src/types.ts` — Add `HierarchicalStoreContract` interface (covers D1, D2)
6. `src/types.ts` — Extend `IndexingStage` with `"summarize"`, add optional `hierarchicalStore` to `RuntimeServices` (covers E1, E2)
7. **Verify** — `npm run build && npm run typecheck` to confirm existing code still compiles (covers E3)
8. `src/__tests__/unit/hierarchicalTypes.test.ts` — Write compile-time contract tests for all new types (covers A1–E3)
9. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: HIER-1 | Epic: Epic 11 — Hierarchical Document Model and Tree Chunker*
