# CHK-5: Scoped tags (frontmatter on note, inline on enclosing nodes)

**Story**: Extract **tags** while chunking: **frontmatter** tags attach to the **`note`** node; **inline `#tags`** attach to the **innermost enclosing structural node** (README §11), returning **`ParsedTag[]`** in **`ChunkNoteResult.tags`** alongside existing `nodes` and `crossRefs` ([CHK-4](CHK-4.md)).
**Epic**: 2 — Hierarchical chunking and note metadata
**Size**: Medium
**Status**: Open

---

## 1. Summary

[README §11 Scoped tags](../../README.md#11-scoped-tags) and the [`tags` table](../../README.md#8-sqlite-schema) require **node-scoped** tag rows with **`source`** ∈ `frontmatter` | `inline`. This story completes the **chunking** side: produce **`ParsedTag`** DTOs aligned with SQLite semantics. **Persistence** is **STO-3 / STO-1**—not here.

**Frontmatter:** [CHK-1](CHK-1.md) strips YAML from the Markdown body before block parsing; CHK-5 **parses the same frontmatter block** (before strip) for `tags:` (array or scalar) and optional singular `tag:`—behavior documented in §5. Tags apply to **`note`** only with `source: 'frontmatter'`.

**Inline tags:** Scan **paragraph**, **bullet**, and **heading** text for Obsidian-style `#tag` tokens; assign to **that** node’s `id` with `source: 'inline'`. **Do not** treat hashtags inside fenced code blocks or inline code spans as tags (fixtures required).

**Interaction with CHK-4:** `ChunkNoteResult` already includes `tags: []`; this story **populates** it. **`crossRefs`** behavior remains unchanged.

Pointers: [REQUIREMENTS §5](../requirements/REQUIREMENTS.md) (tags scoped to hierarchy); [ADR-002](../decisions/ADR-002-hierarchical-document-model.md); [src/core/domain/types.ts](../../src/core/domain/types.ts).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Hierarchical note model implies **scoped** metadata, not only note-level. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Tag extraction stays in **core**; no vault FS access. |

**None additional.**

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README `tags` table CHECK values match **`ParsedTag.source`**
- [ ] Section 4 has 3–8 binding bullets
- [ ] Phase Y includes **non-mock** evidence
- [ ] **Prerequisite:** [CHK-4](CHK-4.md) (`ChunkNoteResult`, `ParsedTag` type, `vaultPath` on input, `chunkNote` entry point)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — **Core import rules** unchanged (`verify:core-imports`).
2. **Y2** — Every `ParsedTag.nodeId` **must** exist in `ChunkNoteResult.nodes` **except** if documented otherwise—**no exceptions**: frontmatter tags use **`note`** node id.
3. **Y3** — **Tag string normalization:** Store **without** leading `#`; preserve case as written in source (Obsidian allows mixed case). **Collapse** internal whitespace in tag body per documented rule (e.g. `#two words` illegal in Obsidian—document skip or error).
4. **Y4** — **Frontmatter keys:** Support at minimum `tags:` as YAML **array** or **comma-separated scalar** (document which); optional `tag:` singular string—tests lock supported shapes.
5. **Y5** — **Inline tag regex** must **exclude** matches inside **fenced code blocks** (``` … ```) and **inline code** (backticks); tests must include negative cases.
6. **Y6** — **Duplicate** `(nodeId, tag, source)` in output: **dedupe** in chunker output **or** allow duplicates—**choose one** and test (recommend **dedupe** for stable STO upserts).

---

## 5. API Endpoints + Schemas

No HTTP routes. Types **`ParsedTag`** and **`ChunkNoteResult`** are defined in CHK-4; this story **fills `tags`**.

| Attribute | Value |
|-----------|-------|
| Surface | `chunkNote` behavior extension only |
| Auth | N/A |

```ts
// ParsedTag already in types.ts from CHK-4:
// { nodeId: string; tag: string; source: 'frontmatter' | 'inline'; }
```

**Supported frontmatter examples (minimum):**

```yaml
---
tags: [reading, inbox]
---
```

```yaml
---
tags: reading, inbox
---
```

```yaml
---
tag: single
---
```

Implementer documents unsupported YAML (nested objects, etc.) as **ignored** or **error**—tests cover chosen behavior.

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

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/frontmatterTags.ts` | Parse YAML frontmatter for tag keys only (minimal surface); pure functions + tests. |
| 2 | `src/core/domain/inlineTags.ts` | Scan text for `#tag` tokens with code-fence awareness; unit tests. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/chunker.ts` | Parse frontmatter before strip; populate `result.tags`; run inline scan on relevant node `content` strings. |
| 2 | `src/core/domain/chunker.test.ts` | Frontmatter + inline + exclusion fixtures. |
| 3 | `package.json` | Add **pure JS** YAML parser dependency (e.g. `yaml`) if Implementer does not use a minimal hand-rolled parser—**no** native addons. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IDocumentStore.ts` — STO-3 persists tags.
- `src/core/domain/types.ts` — `ParsedTag` added in CHK-4 unless CHK-5 discovers a gap.

---

## 8. Acceptance Criteria Checklist

### Phase A: Frontmatter

- [ ] **A1** — Note with `tags: [a, b]` in frontmatter yields two `ParsedTag` rows with `source: 'frontmatter'`, both referencing the **`note`** node id, `tag` values `a` and `b` (after normalization per Y3).
  - Evidence: `src/core/domain/chunker.test.ts::A1_frontmatter_tags_array(vitest)`

- [ ] **A2** — Singular `tag: foo` yields one frontmatter tag on **`note`**.
  - Evidence: `src/core/domain/chunker.test.ts::A2_frontmatter_tag_singular(vitest)`

- [ ] **A3** — Frontmatter does not appear in any `paragraph`/`bullet` `content` (CHK-1 invariant preserved).
  - Evidence: `src/core/domain/chunker.test.ts::A3_frontmatter_not_in_body_nodes(vitest)`

### Phase B: Inline

- [ ] **B1** — Paragraph text `Hello #idea world` yields `ParsedTag` `{ tag: 'idea', source: 'inline' }` on that **paragraph**’s id.
  - Evidence: `src/core/domain/chunker.test.ts::B1_inline_paragraph_tag(vitest)`

- [ ] **B2** — `#tag` inside fenced code block does **not** produce `ParsedTag`.
  - Evidence: `src/core/domain/chunker.test.ts::B2_no_tag_in_fence(vitest)`

- [ ] **B3** — `#tag` inside inline `` `code` `` does **not** produce `ParsedTag`.
  - Evidence: `src/core/domain/chunker.test.ts::B3_no_tag_in_inline_code(vitest)`

### Phase C: Integration

- [ ] **C1** — `chunkNote` returns non-empty `tags` when both frontmatter and inline tags exist in one note; `crossRefs` still correct per CHK-4.
  - Evidence: `src/core/domain/chunker.test.ts::C1_combined_tags_and_links(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `npm run verify:core-imports` and `npm run check:boundaries` pass.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` and `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** YAML/frontmatter dependency (if any) appears in `package.json` and is not a native module.
  - Evidence: `package.json` lists parser package (e.g. `yaml`); `npm install` succeeds on a clean tree (CI or local log)

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file under `src/core/domain/`
  - Evidence: ESLint on touched paths

- [ ] **Z4** — **N/A** — No `@shared/types` alias in this repo.

- [ ] **Z5** — No logging of note content or tag sets at default verbosity.
  - Evidence: Code review

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | YAML edge cases (anchors, complex types) | Restrict to simple scalars/arrays; ignore unknown with test. |
| 2 | Inline `#` in URLs | URL exclusion or regex boundary rules + tests. |

---

## Implementation Order

1. `frontmatterTags.ts` + tests (**A1**, **A2**).
2. `inlineTags.ts` + tests (**B1**–**B3**).
3. Integrate in `chunker.ts` pipeline before/after existing strip (**A3**, **C1**).
4. **Verify** — full test, lint, build, boundary scripts (**Z1**, **Y1**).

---

*Created: 2026-04-05 | Story: CHK-5 | Epic: 2 — Hierarchical chunking and note metadata*
