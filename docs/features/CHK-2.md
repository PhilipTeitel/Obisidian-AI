# CHK-2: Sentence-boundary splitting for embedding limits

**Story**: Extend the hierarchical chunker so **long `paragraph` nodes** are split into child **`sentence_part`** nodes on **sentence boundaries**, preserving **reassembly order** via `siblingOrder` and keeping the **`paragraph` as the structural parent**, aligned with README §6 and ADR-002.
**Epic**: 2 — Hierarchical chunking and note metadata
**Size**: Medium
**Status**: Open

---

## 1. Summary

[README §6 Sentence splitting](../../README.md#6-sentence-splitting) and [ADR-002 §Decision point 4](../decisions/ADR-002-hierarchical-document-model.md) require that paragraphs exceeding the effective **embedding input budget** are split **without** arbitrary mid-word cuts. This story adds a **rule-based sentence splitter** and a **token estimator** in `src/core/domain/` and integrates them into the CHK-1 chunker pipeline.

**Short paragraphs** (at or below the threshold) remain **unchanged** from CHK-1: a single `paragraph` leaf with **no** `sentence_part` children.

**Split paragraphs** become a **`paragraph` parent** whose **children** are exclusively `sentence_part` nodes (in document order). The parent’s `content` **must still hold the full original paragraph text** (verbatim per the normalization rules in section 5) so downstream **summary/context** workflows can treat the paragraph as a semantic unit; **content embeddings** for oversize paragraphs target **`sentence_part` leaves only** (enforced in WKF-2 / embedding workflow, out of scope here—but the tree shape must make that possible).

Pointers: [CHK-1](CHK-1.md) (baseline chunker); [docs/requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §5 (paragraph sentence split); [src/core/domain/types.ts](../../src/core/domain/types.ts).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                          | Why it binds this story                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Sentence-boundary splits with stable ordering for reassembly. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)               | Splitting logic stays in **core**; no sidecar/plugin imports. |

**None additional** — no new persistence, embedding vendor, or transport decision is introduced here.

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs agree that oversize paragraphs use **sentence boundaries** and **`sentence_part`** children under the **same `paragraph` parent**
- [ ] Section 4 (Binding constraints) has 3–8 bullets aligned with those sources
- [ ] Phase Y includes **non-mock** evidence (scripts and/or tests) for core boundaries and split invariants
- [ ] **Prerequisite:** [CHK-1](CHK-1.md) implemented (`chunkNoteToDocumentNodes`, `paragraph` nodes, hashing, trails, core import rules)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Same **forbidden imports** as CHK-1 / FND-3: no `obsidian`, `electron`, `better-sqlite3`, `@sqlite.org/sqlite-wasm`, or `src/plugin` / `src/sidecar` paths from `src/core/**`.
2. **Y2** — A `paragraph` node **either** has **zero** `sentence_part` children (unsplit leaf) **or** has **one or more** `sentence_part` children **only** (no mixing with other child types under that paragraph).
3. **Y3** — For a split paragraph, **concatenating** child `sentence_part.content` values in **`siblingOrder`** order reproduces the parent paragraph’s canonical body (see section 5 normalization)—no dropped or duplicated characters relative to that canonical form.
4. **Y4** — Each `sentence_part` inherits **`headingTrail`**, **`depth`**, and **`noteId`** semantics **as if** it were direct content under the same structural context as the parent `paragraph` (trail matches the parent paragraph’s trail; depth = parent `depth + 1`).
5. **Y5** — **Token threshold** is driven by `ChunkNoteInput` (new field) with a **documented default** constant when the field is omitted (Implementer picks default, e.g. 8000, and documents alignment with MVP embedding models in JSDoc).
6. **Y6** — **`contentHash`**: parent paragraph hashes the **full** canonical paragraph string; each `sentence_part` hashes **its own** `content` string (same SHA-256 hex scheme as CHK-1).
7. **Y7** — **Abbreviations / edge cases:** The splitter **must not** split on a period that is part of a documented minimal set of English abbreviations (e.g. `e.g.`, `i.e.`, `Dr.`, `Mr.`, `Mrs.`, `Ms.`, `vs.`, `etc.`)—encode in tests (see Phase A).

---

## 5. API Endpoints + Schemas

No HTTP routes. Extend the CHK-1 core API:

| Attribute | Value                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Surface   | `ChunkNoteInput`, `chunkNoteToDocumentNodes` in `src/core/domain/chunker.ts`; new helpers in `sentenceSplitter.ts`, `tokenEstimator.ts` |
| Auth      | N/A                                                                                                                                     |

```ts
export interface ChunkNoteInput {
  noteId: string;
  noteTitle: string;
  markdown: string;
  /**
   * When omitted, use DEFAULT_MAX_EMBEDDING_TOKENS (exported constant).
   * Paragraphs with estimateTokens(content) > this value are split into sentence_part children.
   */
  maxEmbeddingTokens?: number;
}
```

**Canonical paragraph body (for concatenation tests):** Normalization rules must be **fixed and tested**—e.g. trim trailing newlines only, preserve internal newlines if present, or collapse `\n+` to single space—**pick one** and document in `sentenceSplitter.ts` JSDoc.

**No changes** to `DocumentNode` fields in `types.ts` unless a gap is discovered (then update this spec in the same PR).

---

## 6. Frontend Flow

Not applicable. Domain-only story.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                  | Purpose                                                                                              |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/sentenceSplitter.ts` | Split paragraph text into sentences (rule-based; exported for tests).                                |
| 2   | `src/core/domain/tokenEstimator.ts`   | `estimateTokens(text: string): number` — documented heuristic used consistently for split decisions. |

### Files to MODIFY

| #   | Path                                | Change                                                                                                                                                       |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `src/core/domain/chunker.ts`        | After paragraph node creation, run token estimate + optional split into `sentence_part` children; recompute `siblingOrder` under affected parents if needed. |
| 2   | `tests/core/domain/chunker.test.ts` | Fixtures for split, no-split, abbreviation edge cases, hash invariants.                                                                                      |
| 3   | `src/core/index.ts`                 | Re-export `DEFAULT_MAX_EMBEDDING_TOKENS` (and splitter/estimator if useful to adapters).                                                                     |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IDocumentStore.ts` — embedding **skips** are workflow concerns (WKF-2).
- `src/sidecar/**`, `src/plugin/**` — no integration in this story.

---

## 8. Acceptance Criteria Checklist

### Phase A: Sentence splitting behavior

- [ ] **A1** — **No split when under threshold:** Given a paragraph whose `estimateTokens` is ≤ `maxEmbeddingTokens`, output contains **no** `sentence_part` nodes under that paragraph.
  - Evidence: `tests/core/domain/chunker.test.ts::A1_no_split_under_threshold(vitest)`

- [ ] **A2** — **Split when over threshold:** Given a paragraph whose content exceeds the threshold, the paragraph has ≥1 child of type `sentence_part` and **no** other child types.
  - Evidence: `tests/core/domain/chunker.test.ts::A2_split_over_threshold(vitest)`

- [ ] **A3** — **Reassembly:** For every split paragraph, joined `sentence_part` contents in `siblingOrder` order equal the parent’s canonical paragraph body per documented normalization.
  - Evidence: `tests/core/domain/chunker.test.ts::A3_reassembly_matches_parent_content(vitest)`

- [ ] **A4** — **Sibling order contiguous:** Under each split paragraph, `sentence_part` nodes have `siblingOrder` 0..n-1.
  - Evidence: `tests/core/domain/chunker.test.ts::A4_sentence_part_sibling_order(vitest)`

- [ ] **A5** — **Abbreviation guard:** Fixture containing `Dr. Smith went to Washington. He stayed.` produces **two** sentences (not three at `Dr.`).
  - Evidence: `tests/core/domain/chunker.test.ts::A5_abbreviation_dr(vitest)` _(may call `sentenceSplitter` module directly or via split paragraph)_

### Phase B: Metadata + hashing

- [ ] **B1** — **`headingTrail` / `depth`:** For `sentence_part` under a paragraph, `headingTrail` equals the parent paragraph’s `headingTrail`; `depth === parent.depth + 1`.
  - Evidence: `tests/core/domain/chunker.test.ts::B1_trail_and_depth_inherit(vitest)`

- [ ] **B2** — **Hashes:** Parent `contentHash` verifies against full paragraph text; each part’s `contentHash` verifies against that part’s `content`.
  - Evidence: `tests/core/domain/chunker.test.ts::B2_contenthash_split_nodes(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `npm run verify:core-imports` and `npm run check:boundaries` pass with new modules under `src/core/domain/`.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` and `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** `estimateTokens` implementation is **pure TypeScript** in `src/core/domain/tokenEstimator.ts` with **no** native-only tokenizer dependencies (no WASM/native addons in core for this story).
  - Evidence: `package.json` inspection + `src/core/domain/tokenEstimator.ts` import scan; `tests/core/domain/chunker.test.ts::Y2_token_estimator_has_no_native_tokenizer(vitest)` (static assertion or comment-backed test listing forbidden patterns)

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file under `src/core/domain/` (and `src/core/index.ts` if touched)
  - Evidence: ESLint on touched paths

- [ ] **Z4** — **N/A** — No `@shared/types` alias in this repo.

- [ ] **Z5** — No logging of full note bodies or API keys from splitter/chunker; errors throw or return documented failures only.
  - Evidence: Code review + grep for `console.` in new files

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                        | Mitigation                                                                          |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | Heuristic `estimateTokens` ≠ real tokenizer            | Document margin; default threshold conservative; WKF can re-check before API call.  |
| 2   | Regex sentence split wrong on URLs, decimals, ellipses | Add targeted fixtures as bugs are found; keep splitter module focused and testable. |

---

## Implementation Order

1. `tokenEstimator.ts` — `estimateTokens` + export `DEFAULT_MAX_EMBEDDING_TOKENS` (**Y5**, **Y2**).
2. `sentenceSplitter.ts` — split API + abbreviation tests (**A5**, **A3**).
3. Integrate into `chunker.ts` post-paragraph build (**A1**, **A2**, **B1**, **B2**).
4. Expand `chunker.test.ts` (**A3**, **A4**, **B1**, **B2**).
5. **Verify** — `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:core-imports`, `npm run check:boundaries` (**Z1**, **Y1**).

---

_Created: 2026-04-05 | Story: CHK-2 | Epic: 2 — Hierarchical chunking and note metadata_
