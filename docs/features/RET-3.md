# RET-3: Tag-aware filtering in search (where index exposes tags)

**Story**: Extend **`NodeFilter`** and **`SqliteDocumentStore.searchContentVectors`** so semantic search can **restrict hits** to nodes that carry **any of** a caller-supplied tag set (OR semantics, case-insensitive match on stored tag text), using the existing **`tags`** table ([README §8](../../README.md#8-sqlite-schema)); thread optional **`tags`** from **`SearchRequest`** through **`SearchWorkflow`** Phase 2 (and optionally Phase 1 post-filter — see below).
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Small
**Status**: Open

---

## 1. Summary

[REQUIREMENTS §5](../requirements/REQUIREMENTS.md) scopes tags to structural nodes; [README §11](../../README.md#11-scoped-tags) states tag-aware filtering is a goal. The SQLite schema already stores **`tags(node_id, tag, source)`**. This story adds **optional** search filtering without breaking untagged queries.

**Phase 1 (summary ANN)** operates on summary vectors attached to **non-leaf** nodes; tags often live on **leaves** or note roots. MVP behavior: **apply tag filter in Phase 2** (`searchContentVectors`) unconditionally when `tags` is non-empty; **after** Phase 1, **drop** coarse candidates whose **note** contains **no** indexed row in `tags` matching the filter (SQL `EXISTS` on `note_id` via join to `nodes`) so irrelevant regions are not expanded. Document this rule in code comments.

**Prerequisites:** [CHK-5](CHK-5.md), [STO-3](STO-3.md), [RET-1](RET-1.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Tags scoped to nodes; filter joins `tags` → `nodes`. |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md) | Filtering must not replace phased retrieval; only constrains candidates. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: No **Tensions / conflicts** identified._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Tag matching is **case-insensitive** for ASCII A–Z at minimum (lower-case both sides in SQL with `COLLATE NOCASE` or equivalent).
2. **Y2** — **`NodeFilter.tagsAny`** (or `tags?: string[]` on filter only — pick one name and use consistently) means **OR**: node matches if **any** listed tag equals a row for that `node_id`.
3. **Y3** — Empty or omitted tag list means **no tag predicate** (backward compatible with RET-1 tests).
4. **Y4** — Filter is enforced **in SQLite** for Phase 2 (no “fetch all ANN then filter in JS” for the vec query path).
5. **Y5** — `SearchRequest` gains optional **`tags?: string[]`** mirroring the filter; sidecar copies request → workflow.

---

## 5. API Endpoints + Schemas

```ts
export interface NodeFilter {
  noteIds?: string[];
  nodeTypes?: NodeType[];
  subtreeRootNodeIds?: string[];
  /** If non-empty, restrict to nodes that have at least one of these tags (OR, case-insensitive). */
  tagsAny?: string[];
}

export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
  tags?: string[];
}
```

IPC / README table: extend `search` payload row when SRV-* updates docs in the same PR as implementation.

---

## 6. Frontend Flow

Not applicable (UI-1 may add tag chips later).

### 6a. Component / Data Hierarchy

```
(n/a)
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
| — | — | (none required) |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | `NodeFilter.tagsAny`, `SearchRequest.tags`. |
| 2 | `src/sidecar/adapters/SqliteDocumentStore.ts` | SQL `EXISTS`/join on `tags` when `tagsAny` set. |
| 3 | `src/sidecar/adapters/SqliteDocumentStore.test.ts` | Fixture with tagged nodes; assert filter. |
| 4 | `src/core/workflows/SearchWorkflow.ts` | Map `SearchRequest.tags` → filter; Phase 1 note-level prune. |
| 5 | `src/core/workflows/SearchWorkflow.test.ts` | Fake store asserts `tagsAny` passed through. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IDocumentStore.ts` — signature already uses `NodeFilter`; extended fields are backward compatible.

---

## 8. Acceptance Criteria Checklist

### Phase A: Request wiring

- [ ] **A1** — When `SearchRequest.tags` is `['foo']`, `searchContentVectors` receives `filter.tagsAny` containing `'foo'` (same casing as request).
  - Evidence: `src/core/workflows/SearchWorkflow.test.ts::A1_tags_forwarded(vitest)`

### Phase B: SQLite behavior

- [ ] **B1** — Given two content nodes only one of which has tag `#Foo`, ANN with `tagsAny: ['foo']` returns **only** the tagged node (distance ordering preserved among matches).
  - Evidence: `src/sidecar/adapters/SqliteDocumentStore.test.ts::B1_tag_filter_sqlite(vitest)`

- [ ] **B2** — `tagsAny: ['a', 'b']` returns nodes tagged **either** `a` or `b`.
  - Evidence: `src/sidecar/adapters/SqliteDocumentStore.test.ts::B2_tag_or_semantics(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** Tag filter SQL references the physical table name **`tags`** and joins through **`nodes`** (grep-based proof in review or comment in test file pointing to migration STO-1).
  - Evidence: `src/sidecar/adapters/SqliteDocumentStore.test.ts::Y1_uses_tags_table(vitest)` (assert via prepared statement string snapshot or documented `toContain('tags')` on SQL builder output)

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — **N/A**
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Phase 1 summary nodes rarely tagged | Note-level `EXISTS` prune documented in RET-3 §1. |
| 2 | OR semantics vs user expectation of AND | Document in README Plugin Settings / user doc follow-up (DOC-1). |

---

## Implementation Order

1. `types.ts` — `tagsAny` / `SearchRequest.tags`.
2. `SqliteDocumentStore.ts` + integration tests **B1, B2, Y1**.
3. `SearchWorkflow.ts` + tests **A1**.
4. **Final verify** — build + lint + vitest.

---

*Created: 2026-04-05 | Story: RET-3 | Epic: 5 — Retrieval, search workflow, and chat workflow*
