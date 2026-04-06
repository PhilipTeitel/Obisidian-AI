# CHK-4: Wikilinks and markdown links → cross-reference extraction

**Story**: Extract **wikilinks** and **vault-relative markdown links** while chunking, emitting a **`ParsedCrossRef[]`** alongside hierarchical nodes so a later store story can persist `cross_refs` per README §8 / §12. Refactor the chunker **public API** to a **`ChunkNoteResult`** object (`nodes` + `crossRefs`; `tags` empty until CHK-5).
**Epic**: 2 — Hierarchical chunking and note metadata
**Size**: Medium
**Status**: Open

---

## 1. Summary

[README §12 Cross-References](../../README.md#12-cross-references) and the [`cross_refs` schema](../../README.md#8-sqlite-schema) require capturing **outbound links** from note content with **`source_node_id`**, **`target_path`** (vault-relative), and optional **`link_text`**. This story implements **parsing only** in `src/core/domain/`: wikilinks (`[[Note]]`, `[[Note|alias]]`, `[[folder/Note]]`) and markdown links whose targets **look like vault files** (e.g. end with `.md` or are relative paths without URL scheme).

**Persistence** (`IDocumentStore`, SQLite) is **out of scope**—handled in **STO-3** and migrations **STO-1**. Here we only produce **typed DTOs** consumable by those adapters.

**Public API refactor:** Earlier CHK specs used `chunkNoteToDocumentNodes(): DocumentNode[]`. This story makes the **canonical** export return **`ChunkNoteResult`** so CHK-5 can add `tags` without another breaking change. Implementers may keep a thin **`nodesOnly`** helper for internal tests if desired, but **primary** export must be the result object.

Pointers: [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) (structure); [CHK-1](CHK-1.md), [CHK-2](CHK-2.md), [CHK-3](CHK-3.md); [src/core/ports/IDocumentStore.ts](../../src/core/ports/IDocumentStore.ts) (no signature change here).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                          | Why it binds this story                                                                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Links attach to **structural** content units in the tree.                               |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)               | Parsing stays in **core**; vault file I/O stays plugin-side—paths are **strings** only. |

**None additional.**

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README `cross_refs` columns align with **`ParsedCrossRef`** fields (semantic match; DB `id` is assign-on-insert)
- [ ] Section 4 has 3–8 binding bullets
- [ ] Phase Y includes **non-mock** evidence (boundary scripts + tests)
- [ ] **Prerequisite:** [CHK-1](CHK-1.md) baseline chunker; **CHK-3** recommended so `sourceNodeId` targets stable **paragraph/bullet/topic** ids (links inside lists attach to **`bullet`** nodes)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — **Core import rules** unchanged (FND-3 / `verify:core-imports`).
2. **Y2** — Every `ParsedCrossRef.sourceNodeId` **must** equal the `id` of a **`DocumentNode`** in the **same** `ChunkNoteResult.nodes` array (the **innermost** enclosing structural node for the link occurrence—see §5).
3. **Y3** — **`targetPath` normalization:** Produce **vault-relative** paths using **forward slashes**; resolve **relative** markdown links against `ChunkNoteInput.vaultPath` (directory of the current note); strip leading `./`; reject or skip `http:`, `https:`, `mailto:`, and fragment-only targets per documented rules in code + tests.
4. **Y4** — **Wikilink resolution:** `[[foo]]` → `targetPath` `foo.md` **if** Implementer documents Obsidian-default “add .md” behavior **or** preserves inner path as given when it already ends with `.md` / has extension—**choose one strategy**, test both cases.
5. **Y5** — **Duplicates:** The same link appearing twice in the same source node may produce **two** `ParsedCrossRef` rows (store dedup is STO-3 concern) **or** one row—document choice; tests must lock behavior.
6. **Y6** — **`ChunkNoteResult.tags`:** Present as **`ParsedTag[]`** always, **`[]` until CHK-5** (field exists for forward compatibility).

---

## 5. API Endpoints + Schemas

No HTTP routes.

| Attribute | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Surface   | `chunkNote`, `ChunkNoteInput`, `ChunkNoteResult`, `ParsedCrossRef` |
| Auth      | N/A                                                                |

```ts
// Add to src/core/domain/types.ts (or chunker.ts if team prefers colocation—prefer types.ts for STO-3 import stability)
export interface ParsedCrossRef {
  /** Same as `nodes.id` for the enclosing structural node. */
  sourceNodeId: string;
  /** Vault-relative path to linked note/file. */
  targetPath: string;
  /** Display / alias text, or null when absent. */
  linkText: string | null;
}

export interface ParsedTag {
  nodeId: string;
  tag: string;
  source: 'frontmatter' | 'inline';
}

export interface ChunkNoteResult {
  nodes: DocumentNode[];
  crossRefs: ParsedCrossRef[];
  /** CHK-5 populates; CHK-4 always returns []. */
  tags: ParsedTag[];
}

export interface ChunkNoteInput {
  noteId: string;
  noteTitle: string;
  /** Vault-relative path of this note (used to resolve relative links). */
  vaultPath: string;
  markdown: string;
  maxEmbeddingTokens?: number; // from CHK-2 when present
}

export function chunkNote(input: ChunkNoteInput): ChunkNoteResult;
```

**Source node selection (innermost enclosing node):**

- Link inside **paragraph** text → `sourceNodeId` = that **`paragraph`** id.
- Link in **bullet** item text → **`bullet`** id.
- Link in **heading line** → **`topic` / `subtopic`** id for that heading.
- Link in **note preamble** before first heading → **`note`** root id.

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

| #   | Path                                | Purpose                                                                                                 |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/wikilinkParser.ts` | Extract link spans from plain strings (wikilink + md link patterns); unit-testable without full MD AST. |

### Files to MODIFY

| #   | Path                                | Change                                                                                                                                   |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/types.ts`          | Add `ParsedCrossRef`, `ParsedTag`, `ChunkNoteResult`; extend `ChunkNoteInput` with `vaultPath`.                                          |
| 2   | `src/core/domain/chunker.ts`        | Rename/refactor primary API to `chunkNote` → `ChunkNoteResult`; invoke wikilink parser when emitting node `content`; attach `crossRefs`. |
| 3   | `tests/core/domain/chunker.test.ts` | Assert `crossRefs` + refactor prior assertions to `result.nodes`.                                                                        |
| 4   | `src/core/index.ts`                 | Export new types + `chunkNote`.                                                                                                          |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IDocumentStore.ts` — STO-3 adds persistence methods if needed.
- Database migrations — STO-1.

---

## 8. Acceptance Criteria Checklist

### Phase A: Extraction correctness

- [ ] **A1** — **`[[Simple]]`** in a paragraph yields one `ParsedCrossRef` with `linkText` per Y4 strategy and `sourceNodeId` equal to that paragraph’s id.
  - Evidence: `tests/core/domain/chunker.test.ts::A1_wikilink_simple(vitest)`

- [ ] **A2** — **`[[Target|Alias]]`** yields `linkText === 'Alias'` and `targetPath` resolving to `Target` per normalization rules.
  - Evidence: `tests/core/domain/chunker.test.ts::A2_wikilink_pipe_alias(vitest)`

- [ ] **A3** — **Markdown link** `[label](./other.md)` resolves `targetPath` relative to `vaultPath`’s directory.
  - Evidence: `tests/core/domain/chunker.test.ts::A3_markdown_relative_link(vitest)`

- [ ] **A4** — **HTTP URL skipped:** `[x](https://example.com/a.md)` does **not** produce a `ParsedCrossRef` (or documented alternative—must match binding Y3).
  - Evidence: `tests/core/domain/chunker.test.ts::A4_http_skipped(vitest)`

### Phase B: API shape

- [ ] **B1** — **`chunkNote` returns `ChunkNoteResult`** with `nodes` matching prior structural invariants from CHK-1/2/3 (single root, etc.).
  - Evidence: `tests/core/domain/chunker.test.ts::B1_result_shape_nodes(vitest)`

- [ ] **B2** — **`tags` always `[]` in CHK-4.**
  - Evidence: `tests/core/domain/chunker.test.ts::B2_tags_empty_until_chk5(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `verify:core-imports` + `check:boundaries` pass.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` and `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** Every `crossRefs[i].sourceNodeId` exists in `nodes` (automated assertion over all fixtures).
  - Evidence: `tests/core/domain/chunker.test.ts::Y2_all_source_ids_resolve(vitest)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file under `src/core/**` touched by this story
  - Evidence: ESLint on touched paths

- [ ] **Z4** — **N/A** — No `@shared/types` alias in this repo.

- [ ] **Z5** — No logging of full note bodies; link targets may appear only in **debug**-gated paths if ever added (default: none).
  - Evidence: Code review

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                    | Mitigation                                                                          |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Wikilink edge cases (`[[#heading]]`, embeds `![[`) | Document unsupported forms; strip embed/blocks in parser tests.                     |
| 2   | API rename breaks unmerged callers                 | Repo currently spec-only; document rename in PR and CHK-1 follow-up note if needed. |

---

## Implementation Order

1. Add domain types in `types.ts` (**B1**, **B2**).
2. Implement `wikilinkParser.ts` with focused unit tests (**A1**–**A4**).
3. Wire parser into `chunker.ts` during node `content` assignment (**A1**–**A3**, **Y2**).
4. Refactor tests to `chunkNote` / `ChunkNoteResult` (**B1**, **B2**).
5. **Verify** — `npm run test`, `npm run build`, boundary scripts (**Z1**, **Y1**).

---

_Created: 2026-04-05 | Story: CHK-4 | Epic: 2 — Hierarchical chunking and note metadata_
