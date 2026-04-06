# STO-3: `SqliteDocumentStore` implementing `IDocumentStore`

**Story**: Implement **`SqliteDocumentStore`** in the sidecar — a concrete adapter for [IDocumentStore](../../src/core/ports/IDocumentStore.ts) over `better-sqlite3`, relational tables from STO-1, and sqlite-vec from STO-2 — providing CRUD for nodes/summaries/tags/cross-refs/note metadata, **ANN search** on summary and content vectors, and **tree navigation** (`getAncestors`, `getSiblings`) for context assembly.
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story wires the **hexagonal storage port** to the real database: all methods on `IDocumentStore` become parameterized SQL (synchronous `better-sqlite3` in the sidecar) plus vec0 KNN queries for `searchSummaryVectors` and `searchContentVectors`. It is the main consumer of schemas from [STO-1](STO-1.md) and [STO-2](STO-2.md).

**Row mapping:** SQLite uses `snake_case` columns per README §8; TypeScript uses `DocumentNode` / `NoteMeta` / `VectorMatch` from [src/core/domain/types.ts](../../src/core/domain/types.ts). The adapter translates at the boundary (`heading_trail` JSON ↔ `headingTrail: string[]`, ISO timestamps ↔ `created_at` / `updated_at`).

**Transactions:** `upsertNodes` should run in a **transaction** per batch so partial tree writes do not corrupt parent/child links. `deleteNote` must remove dependent rows (CASCADE covers most; confirm vec rows and summaries).

**Search:** Phase 1/2 retrieval ([ADR-003](../decisions/ADR-003-phased-retrieval-strategy.md)) depends on correct ANN behavior and `NodeFilter` for content search (restrict to candidate note IDs from phase 1). This story implements the **store** side; `SearchWorkflow` (RET-1) composes calls later.

Pointers: [README API Contract](../../README.md#port-interfaces-internal-service-contracts); ADR-006; [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) (tree semantics).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                          | Why it binds this story                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)               | Adapter lives in sidecar; native SQLite only.                                                               |
| [docs/decisions/ADR-004-per-vault-index-storage.md](../decisions/ADR-004-per-vault-index-storage.md)         | Store operates on the per-vault DB file path supplied by future settings wiring.                            |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md)     | ANN + filter semantics must support coarse → drill-down retrieval.                                          |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Node types and hierarchy inform `getAncestors` / `getSiblings` ordering (document order = `sibling_order`). |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk
- [ ] **Prerequisites:** [STO-1](STO-1.md) and [STO-2](STO-2.md) complete (all tables + vec extension load working in dev)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `SqliteDocumentStore` is defined only under `src/sidecar/**` (e.g. `src/sidecar/adapters/SqliteDocumentStore.ts`); it **implements** `IDocumentStore` imported from `src/core/ports/IDocumentStore.js` without moving SQL into `src/core/`.
2. **Y2** — `upsertNodes` replaces or inserts nodes by `id`; must not leave orphan rows when updating an existing note’s tree — caller may send full note tree; Implementer documents strategy (delete-by-note then insert, or diff) and proves with tests.
3. **Y3** — `upsertEmbedding` writes both the vec0 row (`vec_content` or `vec_summary` by `VectorType`) **and** a row in `embedding_meta` with matching `dimension`, `model`, and `contentHash` from `EmbedMeta`.
4. **Y4** — `searchSummaryVectors` / `searchContentVectors` accept `Float32Array` query vectors whose **length equals** the DB’s configured embedding dimension (same as STO-2); wrong length → clear error.
5. **Y5** — `searchContentVectors` applies `NodeFilter`: when `noteIds` is set, restrict hits to nodes whose `note_id` is in the set; when `nodeTypes` is set, restrict to matching `type` (both optional, combinable with AND).
6. **Y6** — `getAncestors` returns nodes ordered **root → immediate parent** (toward the requested node’s tree, excluding the node itself unless spec says otherwise — **exclude self** to match typical “walk up for context”; document in JSDoc if different).
7. **Y7** — `getSiblings` returns nodes sharing the same `parent_id` and `note_id`, ordered by `sibling_order` ascending, **excluding** the requested `nodeId`.

---

## 5. API Endpoints + Schemas

No new HTTP routes. The public TypeScript surface is **`IDocumentStore`** (already defined). Optional re-export from `src/sidecar/index.ts` for tests.

```ts
// No new shared types required if IDocumentStore + domain types suffice.
// If tests need a factory:
export function createSqliteDocumentStore(
  db: unknown,
): import('../core/ports/IDocumentStore.js').IDocumentStore;
```

---

## 6. Frontend Flow

Not applicable.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                 | Purpose                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/sidecar/adapters/SqliteDocumentStore.ts`        | `IDocumentStore` implementation.                                                                                                                                                          |
| 2   | `tests/sidecar/adapters/SqliteDocumentStore.test.ts` | Unit/integration tests with `:memory:` DB + migrations + vec extension (or mocked vec layer only if Y-binding still covered by integration sibling test — prefer real vec when feasible). |

### Files to MODIFY

| #   | Path                        | Change                                                                                     |
| --- | --------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `src/sidecar/db/migrate.ts` | Export a test helper `openMigratedMemoryDb(options?)` if shared by store tests (optional). |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IDocumentStore.ts` — contract already frozen ([FND-3](FND-3.md)); only change if README and ADRs change (escalate).
- `src/plugin/**` — no document store.

---

## 8. Acceptance Criteria Checklist

### Phase A: CRUD and note metadata

- [x] **A1** — `upsertNodes` + `getNodesByNote` round-trip: persisted `DocumentNode` fields match input (including `headingTrail` JSON and timestamps).
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::A1_nodes_roundtrip(vitest)`

- [x] **A2** — `deleteNote` removes all nodes for `note_id` and dependent summaries, tags, cross_refs, embedding rows (vec + meta) — verified by absence in queries.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::A2_delete_note_cascade(vitest)`

- [x] **A3** — `upsertSummary` and `upsertNoteMeta` / `getNoteMeta` round-trip per README columns.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::A3_summary_note_meta(vitest)`

### Phase B: Vector search and filters

- [x] **B1** — `upsertEmbedding` + `searchSummaryVectors` returns top-`k` matches with **finite** scores ordered best-first (sqlite-vec distance semantics documented in test).
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::B1_summary_ann(vitest)`

- [x] **B2** — `searchContentVectors` with `NodeFilter.noteIds` returns only hits inside those notes.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::B2_content_filter_note_ids(vitest)`

- [x] **B3** — `searchContentVectors` with `NodeFilter.nodeTypes` restricts to those `type` values.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::B3_content_filter_node_types(vitest)`

### Phase C: Tree navigation

- [x] **C1** — `getAncestors` returns correct ordered chain for a small synthetic tree.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::C1_ancestors(vitest)`

- [x] **C2** — `getSiblings` returns ordered siblings excluding self.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::C2_siblings(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `rg "from '../core/" src/sidecar/adapters/SqliteDocumentStore.ts` shows only **permitted** imports into `src/core` (ports/types); **no** imports from `src/plugin`; no `better-sqlite3` in `src/core`.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` + `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [x] **Y2** — **(binding)** `SqliteDocumentStore` source file path is under `src/sidecar/`.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::Y2_adapter_path(vitest)` or filesystem assertion in test

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A if story touches no shared client; document N/A
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                                       | Mitigation                                                                            |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Full note upsert strategy is easy to get wrong vs incremental updates | Start with **delete note subtree + insert batch** in one transaction; optimize later. |
| 2   | sqlite-vec query API differences by version                           | Pin dependency version; encapsulate SQL in one module.                                |

---

## Implementation Order

1. Add `SqliteDocumentStore.ts` skeleton implementing all interface methods (throw `Error('not implemented')` initially).
2. Implement relational methods + mapping helpers.
3. Implement embedding + meta + ANN queries using STO-2 schema.
4. Implement `NodeFilter` SQL composition.
5. Implement ancestors/siblings with iterative/recursive SQL as appropriate (CTE or loop).
6. Fill tests A1–C2, Y-binding, then Z gates.
7. **Final verify** — `npm run build`, `npm test`, boundary scripts.

---

_Created: 2026-04-05 | Story: STO-3 | Epic: 3 — SQLite store, vectors, and indexing persistence_
