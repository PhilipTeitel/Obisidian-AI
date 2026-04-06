# CHK-3: Bullet groups and nested bullets

**Story**: Refine the chunker so **consecutive list items** from the **same Markdown list block** are wrapped in a **`bullet_group` parent** (README §7), with **nested list items** remaining **`bullet`** children of their **parent `bullet`**, preserving **document order** and all CHK-1/CHK-2 metadata rules.
**Epic**: 2 — Hierarchical chunking and note metadata
**Size**: Medium
**Status**: Open

---

## 1. Summary

[README §7 Bullet grouping](../../README.md#7-bullet-grouping) and the hierarchical diagram under [§4](../../README.md#4-hierarchical-document-model) show **`bullet_group`** between structural sections (e.g. `subtopic`) and **`bullet`** leaves. [CHK-1](CHK-1.md) intentionally allowed `bullet` nodes **without** `bullet_group` to unblock the first parse slice. This story **inserts** `bullet_group` nodes per the **“consecutive bullets without a blank line separator”** rule at the **Markdown list** level: each contiguous list in the AST becomes **one** `bullet_group` whose children are the **top-level** list items (`bullet` nodes). **Nested** items stay **`bullet`** children of their parent **`bullet`** (nesting depth matches CommonMark list nesting).

**Interaction with CHK-2:** `sentence_part` applies to **`paragraph`** nodes only. **`bullet` text** is **not** sentence-split in this story unless a future story explicitly extends CHK-2 (out of scope).

Pointers: [ADR-002](../decisions/ADR-002-hierarchical-document-model.md); [CHK-1](CHK-1.md); [CHK-2](CHK-2.md) if merged first.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                          | Why it binds this story                                         |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Explicit **bullet_group** grouping and nested bullet semantics. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)               | Grouping logic remains in **core** only.                        |

**None additional.**

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README §7 and ADR-002 agree on **group** + **nested bullet** modeling
- [ ] Section 4 filled with 3–8 binding bullets
- [ ] Phase Y includes **non-mock** evidence (tests + boundary scripts)
- [ ] **Prerequisite:** [CHK-1](CHK-1.md) complete (Markdown list → `bullet` nodes). **CHK-2** may land before or after CHK-3; if CHK-2 is present, CHK-3 must preserve `sentence_part` invariants for paragraphs.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — **Forbidden imports** unchanged from CHK-1 (`verify:core-imports` / FND-3).
2. **Y2** — Every **`bullet`** node’s **`parentId`** must reference either a **`bullet_group`** (top-level items in that list) or another **`bullet`** (nested item)—never a raw `topic` / `subtopic` / `paragraph` for list items produced from Markdown lists.
3. **Y3** — **`bullet_group` content:** Use **empty string** `content` for `bullet_group` nodes (consistent with structural-only nodes); `contentHash` = SHA-256 of `""` or of a documented constant (must be **deterministic**); document choice in JSDoc and lock with a test.
4. **Y4** — **`headingTrail` / `depth` / `siblingOrder`:** `bullet_group` shares the same **`headingTrail`** as sibling **`paragraph`** nodes under the same section; **`depth`** increments from parent; **`siblingOrder`** is **contiguous** among **all** direct children of the same parent **in document order** (groups interleave with paragraphs as they appear).
5. **Y5** — **Two list blocks separated by a blank line** in source → **two** `bullet_group` siblings (each wrapping its own top-level bullets)—verify with a fixture.
6. **Y6** — **Ordered vs unordered lists** both map to `bullet_group` + `bullet`; list marker type **need not** be stored in CHK-3 (defer to metadata story if ever needed).

---

## 5. API Endpoints + Schemas

No HTTP routes. **No change** to the CHK-1 `ChunkNoteInput` / function name required by this story alone (see [CHK-4](CHK-4.md) for a later unified result type).

| Attribute | Value                                                         |
| --------- | ------------------------------------------------------------- |
| Surface   | `chunkNoteToDocumentNodes` output shape only (tree structure) |
| Auth      | N/A                                                           |

```ts
// No new exported types required if bullet_group uses existing NodeType + DocumentNode.
// bullet_group nodes use type: 'bullet_group', content per Y3 binding.
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

| #   | Path              | Purpose                                                                                               |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | _(none required)_ | Logic may live entirely in `chunker.ts` unless Implementer factors `listGroupBuilder.ts` for clarity. |

### Files to MODIFY

| #   | Path                                | Change                                                                                                            |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/chunker.ts`        | Insert `bullet_group` parents for list blocks; re-parent bullets; recompute `siblingOrder` for affected siblings. |
| 2   | `tests/core/domain/chunker.test.ts` | Replace/adjust CHK-1 list fixtures to expect `bullet_group`; add separation + nesting fixtures.                   |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/domain/types.ts` — `bullet_group` already in `NodeType` (FND-3).
- `src/core/ports/*` — no store writes here.

---

## 8. Acceptance Criteria Checklist

### Phase A: Group structure

- [ ] **A1** — **Top-level list:** A single unordered list under a section yields `… → bullet_group → bullet+` with **no** `bullet` whose parent is the section node.
  - Evidence: `tests/core/domain/chunker.test.ts::A1_list_wrapped_in_bullet_group(vitest)`

- [ ] **A2** — **Nested list:** Nested items are `bullet` children of the parent `bullet`, not siblings in the outer `bullet_group`.
  - Evidence: `tests/core/domain/chunker.test.ts::A2_nested_bullets_under_parent_bullet(vitest)`

- [ ] **A3** — **Blank line separates groups:** Two lists separated by a blank line produce **two** `bullet_group` siblings under the same parent.
  - Evidence: `tests/core/domain/chunker.test.ts::A3_two_groups_blank_line(vitest)`

- [ ] **A4** — **Interleaved paragraph and list:** A paragraph followed by a list under the same heading produces `paragraph` and `bullet_group` **siblings** with `siblingOrder` matching source order.
  - Evidence: `tests/core/domain/chunker.test.ts::A4_paragraph_then_list_order(vitest)`

### Phase B: Metadata

- [ ] **B1** — **`headingTrail` on bullets:** A `bullet` under `bullet_group` has the same `headingTrail` as a `paragraph` sibling in the same section (for the same note fixture).
  - Evidence: `tests/core/domain/chunker.test.ts::B1_bullet_trail_matches_paragraph_sibling(vitest)`

- [ ] **B2** — **Unique ids + hashes:** All nodes remain unique `id`; `contentHash` rules satisfied for `bullet_group` per Y3.
  - Evidence: `tests/core/domain/chunker.test.ts::B2_group_hashes_and_ids(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `npm run verify:core-imports` and `npm run check:boundaries` pass.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` and `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** Output contains **`bullet_group`** for every Markdown-derived list in test fixtures (no “orphan” top-level bullets).
  - Evidence: `tests/core/domain/chunker.test.ts::Y2_no_orphan_top_level_bullets(vitest)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file under `src/core/domain/`
  - Evidence: ESLint on touched paths

- [ ] **Z4** — **N/A** — No `@shared/types` alias in this repo.

- [ ] **Z5** — No logging of raw note content from chunker changes.
  - Evidence: Code review

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                            | Mitigation                                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Parser AST differs (mdast vs markdown-it)  | Anchor tests to concrete fixtures; adjust walker only in chunker.                                      |
| 2   | CHK-1 tests heavily assume pre-group shape | Update fixtures in this story; keep CHK-1 spec as historical—implementation follows latest epic order. |

---

## Implementation Order

1. Adjust list visitation in `chunker.ts` to create `bullet_group` scaffold (**A1**, **A2**).
2. Recompute parent pointers and `siblingOrder` for section children (**A4**, **B1**).
3. Add separation + interleaving fixtures (**A3**, **A4**).
4. **Verify** — full test + lint + build + boundary scripts (**Z1**, **Y1**).

---

_Created: 2026-04-05 | Story: CHK-3 | Epic: 2 — Hierarchical chunking and note metadata_
