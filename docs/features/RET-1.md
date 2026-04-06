# RET-1: `SearchWorkflow` — coarse summary ANN → drill-down content → assembly

**Story**: Implement **`SearchWorkflow`** in core as a port-driven three-phase pipeline: embed query, ANN on summary vectors, scoped content-vector drill-down under coarse candidates, then assemble **`SearchResult[]`** (paths, scores, heading trails, snippets) for the plugin contract — with configurable **`k`** and explicit result shape for later UI (UI-1).
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Large
**Status**: Complete

---

## 1. Summary

Semantic search in this product is **not** flat top-K on content chunks. [ADR-003](../decisions/ADR-003-phased-retrieval-strategy.md) and [REQUIREMENTS §5](../requirements/REQUIREMENTS.md) require **coarse** summary matching, **fine** content matching within those regions, and **assembly** of human-readable snippets. This story delivers the **core orchestration** (`SearchWorkflow`) that composes **`IEmbeddingPort`** (query embedding) and **`IDocumentStore`** (ANN + tree walks only — no SQLite imports in core).

Phase 3 assembly in this story uses **fixed default tier fractions** (60% / 25% / 15%) inlined as constants matching [README §10](../../README.md#10-structured-context-formatting); [RET-2](RET-2.md) replaces those literals with **injected budget settings** and tightens formatting. **Prerequisite:** indexed data via [STO-3](STO-3.md), [WKF-2](WKF-2.md).

Downstream **UI-1** and **CHAT-1** depend on stable `SearchResult` / assembly text shape; this story defines the **search-specific** path. Chat reuses assembly utilities introduced here or shared in RET-2 per implementer choice, but must not duplicate phased retrieval logic outside core.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md) | Mandates summary → drill-down → assembly; comparable embedding space for query vs stored vectors. |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Node types, `headingTrail`, parent/child semantics for walks. |
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md) | Query embeddings only through **`IEmbeddingPort`**; optional `apiKey` from caller. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Core workflow has no `better-sqlite3` / filesystem vault access. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: No **Tensions / conflicts** identified between README, REQUIREMENTS, and accepted ADRs for this story._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `SearchWorkflow` lives under `src/core/workflows/` and must **not** import `better-sqlite3`, `obsidian`, or `src/sidecar/**` concrete adapters.
2. **Y2** — Query embedding uses **`IEmbeddingPort.embed([queryText], apiKey?)`** only; the **same** model configuration as indexing is the caller’s responsibility (sidecar wires settings); workflow accepts the returned `Float32Array` as the query vector.
3. **Y3** — Phase 1 calls **`IDocumentStore.searchSummaryVectors(queryVector, kSummary)`**; Phase 2 calls **`IDocumentStore.searchContentVectors(queryVector, kContent, filter)`** with a filter that **restricts** candidates to **descendants** of Phase 1 hit nodes (see §5 — `NodeFilter.subtreeRootNodeIds`).
4. **Y4** — If Phase 1 returns **no** summary hits, the workflow returns **empty** `results` (no fallback to global content ANN in this story — avoids violating phased strategy).
5. **Y5** — Each `SearchResult` includes resolvable **`notePath`** via **`getNoteMeta(node.noteId)`** / stored vault path convention already used in indexing (`noteId` ↔ `note_meta`).
6. **Y6** — Assembly snippet text must preserve **list/heading structure** at least at the level of [README §10](../../README.md#10-structured-context-formatting) (headings + labeled tiers: matched / sibling / parent summary); exact whitespace may follow implementer preference but must remain stable for tests.
7. **Y7** — Default **`k`**: if `SearchRequest.k` is omitted, use **`searchResultCount`** from settings is **out of scope** in core; use documented constant **`DEFAULT_SEARCH_K = 20`** in workflow module unless caller passes `k` (sidecar maps plugin settings → `k` in SRV-*).

---

## 5. API Endpoints + Schemas

No new HTTP routes are mandatory in this story (SRV-1 may wire `search` later). **IPC contract** already declares `SearchRequest` / `SearchResponse` in [`src/core/domain/types.ts`](../../src/core/domain/types.ts).

**Extend** types as follows (consolidate in `types.ts`):

```ts
/** Optional filter: restrict content ANN to nodes in the subtree of any listed root (Phase 2). */
export interface NodeFilter {
  noteIds?: string[];
  nodeTypes?: NodeType[];
  subtreeRootNodeIds?: string[];
}
```

Expose a **workflow entry** (exact name up to implementer, e.g. `runSearch`):

```ts
export interface SearchWorkflowDeps {
  store: IDocumentStore;
  embedder: IEmbeddingPort;
}

export async function runSearch(
  deps: SearchWorkflowDeps,
  req: SearchRequest,
): Promise<SearchResponse>;
```

`SearchRequest` already has `query`, `k?`, `apiKey?`. Document that **`k`** applies to the **final** ranked result list size after merge/dedup; implementer defines how `k` maps to internal `kSummary` / `kContent` (e.g. `kSummary = min(k, 8)`, `kContent = k`) — **must be asserted in unit tests**.

If **`shared/types.ts`** is introduced in a later story, mirror exports there; until then **N/A** for Z4 (see Phase Z).

---

## 6. Frontend Flow

Not applicable. This story is core + sidecar store filtering only. **UI-1** consumes `SearchResponse` later.

### 6a. Component / Data Hierarchy

```
(n/a — no Obsidian UI)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| — | — | — | — |

### 6c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| — | — |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/workflows/SearchWorkflow.ts` | Three-phase orchestration + assembly (default budgets). |
| 2 | `src/core/workflows/SearchWorkflow.test.ts` | Port fakes; phase ordering; empty Phase 1; snippet shape. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | Extend `NodeFilter` with `subtreeRootNodeIds`. |
| 2 | `src/sidecar/adapters/SqliteDocumentStore.ts` | Implement subtree restriction in `searchContentVectors` SQL (recursive CTE or equivalent). |
| 3 | `src/sidecar/adapters/SqliteDocumentStore.test.ts` | Coverage: subtree filter narrows hits vs unfiltered. |
| 4 | `src/core/index.ts` | Export workflow entry if public API requires it. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — chat out of scope.
- `docs/decisions/ADR-003-phased-retrieval-strategy.md` — accepted; reference only.

---

## 8. Acceptance Criteria Checklist

### Phase A: Phase ordering and embedding

- [x] **A1** — For a non-empty index fake, `runSearch` calls **`embedder.embed`** exactly once with an array whose sole element is the trimmed `SearchRequest.query`.
  - Evidence: `src/core/workflows/SearchWorkflow.test.ts::A1_single_embed_call(vitest)`

- [x] **A2** — After embedding, the workflow calls **`searchSummaryVectors`** before any **`searchContentVectors`**.
  - Evidence: `src/core/workflows/SearchWorkflow.test.ts::A2_summary_before_content(vitest)`

- [x] **A3** — When Phase 1 returns zero summary matches, **`searchContentVectors` is not invoked** and `results` is `[]`.
  - Evidence: `src/core/workflows/SearchWorkflow.test.ts::A3_no_coarse_no_drilldown(vitest)`

### Phase B: Results shape

- [x] **B1** — Each `SearchResult` includes **`nodeId`**, **`notePath`** (vault-relative string), **`score`** (numeric, from content match or documented merge rule), **`snippet`** (non-empty string for hits), **`headingTrail`** (string array, may be empty for note-level).
  - Evidence: `src/core/workflows/SearchWorkflow.test.ts::B1_result_shape(vitest)`

- [x] **B2** — **`SearchRequest.k`** caps the number of results returned (≤ `k` when more candidates exist in fake data).
  - Evidence: `src/core/workflows/SearchWorkflow.test.ts::B2_respects_k_cap(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `SearchWorkflow.ts` contains **no** import path matching `sidecar`, `better-sqlite3`, or `obsidian`.
  - Evidence: `scripts/check-source-boundaries.mjs(npm run check:boundaries)` or `rg --glob 'SearchWorkflow.ts' 'better-sqlite3|obsidian|/sidecar/'` exiting non-zero if matched

- [x] **Y2** — **(binding)** `searchContentVectors` with `subtreeRootNodeIds` set returns **only** rows whose `nodes.id` is the root or a descendant (transitive) of one of the roots in a populated SQLite fixture.
  - Evidence: `src/sidecar/adapters/SqliteDocumentStore.test.ts::Y2_subtree_filter_sqlite(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A**: no `packages/shared`; types remain in `src/core/domain/types.ts`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Subtree SQL complexity vs sqlite-vec `MATCH` row order | Prototype CTE early in `SqliteDocumentStore.test.ts`; keep k small in Phase 2. |
| 2 | Duplicate assembly logic vs CHAT-1 | Extract shared pure functions in `src/core/domain/` in RET-2 if RET-1 assembly grows large. |
| 3 | `k` semantics across two ANN calls | Document and test mapping; avoid silent over-fetch in production. |

---

## Implementation Order

1. `src/core/domain/types.ts` — add `subtreeRootNodeIds` to `NodeFilter`.
2. `src/sidecar/adapters/SqliteDocumentStore.ts` + `.test.ts` — subtree filter **(Y2)**.
3. `src/core/workflows/SearchWorkflow.ts` — implement phases + assembly with default 60/25/15 budgets.
4. `src/core/workflows/SearchWorkflow.test.ts` — **A1–B2**, port ordering fakes.
5. **Verify** — `npm run check:boundaries` (if applicable), `npm run build`, targeted `vitest` for new tests.
6. **Final verify** — full `npm test` / CI parity.

---

*Created: 2026-04-05 | Story: RET-1 | Epic: 5 — Retrieval, search workflow, and chat workflow*
