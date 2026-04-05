# CHK-1: Hierarchical chunker (headings, paragraphs, bullets, ordering, heading trails)

**Story**: Implement a pure-core Markdown → `DocumentNode[]` chunker that builds the hierarchical tree for a single note: `note` root, heading-derived `topic` / `subtopic` sections, `paragraph` blocks, and list items as `bullet` nodes—with correct `siblingOrder`, `depth`, `headingTrail`, and per-node `contentHash`.
**Epic**: 2 — Hierarchical chunking and note metadata
**Size**: Large
**Status**: Open

---

## 1. Summary

This story delivers the **first slice** of the indexing parse pipeline described in [ADR-002](../decisions/ADR-002-hierarchical-document-model.md), [README §4 Hierarchical Document Model](../../README.md#4-hierarchical-document-model), and [REQUIREMENTS §5](../requirements/REQUIREMENTS.md). Vault notes arrive as Markdown strings; the chunker returns a **flat array** of `DocumentNode` rows (parent links via `parentId`) ready for `IDocumentStore.upsertNodes` in later stories.

**Intentionally deferred** (separate backlog items; not contradictions—incremental delivery):

- **CHK-2:** `sentence_part` nodes and sentence-boundary splitting for embedding limits ([README §6](../../README.md#6-sentence-splitting), ADR-002 §Decision point 4).
- **CHK-3:** `bullet_group` wrappers and refined group/nesting rules ([README §7](../../README.md#7-bullet-grouping)).
- **CHK-4 / CHK-5:** Wikilinks and scoped tags.

During **CHK-1-only** development, the chunker **must not** emit `sentence_part` or `bullet_group`. **After [CHK-2](CHK-2.md) and [CHK-3](CHK-3.md)**, the unified `chunkNote` **does** emit those types when the markdown warrants it. A **scoped** regression remains: minimal notes (no lists, no over-threshold paragraph split) still omit them — see §8 **Y2**. The chunker **may** emit `bullet` nodes (including **nested** bullets via `parentId` pointing at another `bullet`) so lists are representable before CHK-3 wraps top-level lists in `bullet_group`.

**Design principle:** All logic lives under `src/core/domain/` with **no** Obsidian, SQLite, network, or sidecar/plugin imports ([FND-3 Y1](FND-3.md)). Parsing uses a **single** well-maintained, **pure JavaScript** Markdown AST or tokenizer added as a normal `dependencies` / `devDependencies` entry (no native addons).

Pointers: [docs/requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §5; ADR-002; [src/core/domain/types.ts](../../src/core/domain/types.ts).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Tree shape, node-type vocabulary, heading context, and split/group rules (applied here only insofar as CHK-1 scope allows; remainder in CHK-2/3). |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Chunker runs in **core** consumed by sidecar workflows later; must remain portable (no renderer or native DB coupling in `src/core`). |

**None additional** — this story does not introduce a new persistence, embedding, auth, or transport binding beyond existing Accepted ADRs.

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries _(sentence splitting and `bullet_group` are explicitly deferred to CHK-2/CHK-3; CHK-1 subset is documented above)_
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk
- [ ] **Prerequisite:** [FND-3](FND-3.md) domain types (`DocumentNode`, `NodeType`) are present in `src/core/domain/types.ts` so the chunker can compile against them

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — No file under `src/core/` may import `obsidian`, `electron`, `better-sqlite3`, `@sqlite.org/sqlite-wasm`, or any `src/sidecar/` / `src/plugin/` path (same bar as [FND-3](FND-3.md) and `scripts/check-core-imports.mjs`).
2. **Y2** — Chunker output nodes must satisfy `DocumentNode` from `types.ts`: valid `NodeType` for emitted rows, non-null `content` (empty string allowed only where explicitly specified below), ISO `createdAt` / `updatedAt`, unique `id` within the returned array.
3. **Y3** — **(historical CHK-1 slice)** Emitted `type` values were restricted to **`note`**, **`topic`**, **`subtopic`**, **`paragraph`**, and **`bullet`** only, with no **`sentence_part`** or **`bullet_group`** until CHK-2/3 landed. The **current** `chunkNote` may emit the full `NodeType` set per [CHK-2](CHK-2.md) / [CHK-3](CHK-3.md); §8 **Y2** locks the minimal-input subset.
4. **Y4** — `headingTrail` for every node is the ordered list of **ancestor heading texts** from the outermost section heading down to the **immediate structural heading parent** (not including the current node’s own title). The `note` root uses `headingTrail: []`. Section headings (`topic` / `subtopic`) use the trail of **their** ancestors (e.g. an H2’s trail is `[H1 text]`).
5. **Y5** — `siblingOrder` is **0-based** and contiguous among **direct children of the same parent** in **document order**.
6. **Y6** — `depth` is root `note` = `0`; each child is parent `depth + 1`.
7. **Y7** — `contentHash` is a **deterministic** lowercase hex string (recommend **SHA-256** of UTF-8 `content`) for **every** emitted node, including the note root. Same `content` string ⇒ same hash (stability for downstream incremental work).
8. **Y8** — **YAML frontmatter** (delimited by `---` at file start) is **stripped** before block structure is derived; frontmatter text must **not** appear in paragraph/bullet `content`. (Tag extraction attaches in CHK-5.)

---

## 5. API Endpoints + Schemas

No HTTP routes. New **TypeScript-only** public API in core:

| Attribute | Value |
|-----------|-------|
| Surface | Exported function(s) from `src/core/domain/chunker.ts` (and re-exported from `src/core/index.ts` if appropriate) |
| Auth | N/A |

```ts
import type { DocumentNode } from './types.js';

/** Inputs needed to chunk one vault note. */
export interface ChunkNoteInput {
  /** Stable index id for the note (caller supplies; same as future `note_id` in SQLite). */
  noteId: string;
  /** Display title for the note root node's `content` (e.g. basename of vault path). */
  noteTitle: string;
  /** Full Markdown source as read from the vault (may start with YAML frontmatter). */
  markdown: string;
}

/**
 * Returns a pre-order-friendly flat list of nodes: exactly one `note` root
 * and descendants. Caller may sort or index by `parentId` as needed.
 */
export function chunkNoteToDocumentNodes(input: ChunkNoteInput): DocumentNode[];
```

**Heading → node type mapping**

| Markdown | `type` | Notes |
|----------|--------|-------|
| Document root | `note` | Single root per call |
| First heading level in note (`#`) | `topic` | Each subsequent `#` at same level = sibling `topic` |
| `##` | `subtopic` | Sibling `subtopic` under current `topic` |
| `###`–`######` | `subtopic` | Deeper headings use `subtopic` with increasing `depth`; `headingTrail` accumulates all ancestor heading strings |

**Blocks**

- Normal paragraphs → `paragraph`.
- List items (`-`, `*`, `+`, ordered) → `bullet`; nested lists → `bullet` children per CommonMark nesting (parent list item = parent node).
- **Fenced code blocks, blockquotes, thematic breaks:** represent as a single `paragraph` whose `content` is the verbatim block text (including fence markers or `>` prefixes) unless the Implementer documents a tighter rule in code comments **and** adds a test proving the chosen behavior—goal is stable, lossless-enough structure for MVP indexing.

---

## 6. Frontend Flow

Not applicable. Chunker is core/domain only; no Obsidian UI.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/chunker.ts` | `ChunkNoteInput`, `chunkNoteToDocumentNodes`, helpers (frontmatter strip, tree build, hashing). |
| 2 | `src/core/domain/chunker.test.ts` | Fixtures proving structure, trails, order, hashes, and core import boundaries (Vitest). |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/index.ts` | Export chunker public API (`chunkNoteToDocumentNodes`, `ChunkNoteInput`). |
| 2 | `package.json` | Add Markdown parse dependency (pure JS) if not already present; lock version range appropriately. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/domain/types.ts` — `DocumentNode` / `NodeType` already defined in FND-3; extend only if story discovers a gap (then update this spec in the same PR).
- `src/core/ports/*` — chunker is not a port; workflows wire later (WKF-2).
- `src/sidecar/*`, `src/plugin/*` — indexing integration is out of scope for CHK-1.

---

## 8. Acceptance Criteria Checklist

### Phase A: Structure and invariants

- [ ] **A1** — **Single root:** For non-empty parse input, output contains exactly one node with `type === 'note'` and `parentId === null`; all other nodes have `parentId` referencing an id present in the same array.
  - Verification: Test builds tree from sample Markdown; assert single root and referential integrity.
  - Evidence: `src/core/domain/chunker.test.ts::A1_single_root_and_parent_refs(vitest)`

- [ ] **A2** — **Headings map to topic/subtopic:** Given a note with `# A`, `## B`, and body text under B, structure reflects `note` → `topic(A)` → `subtopic(B)` → paragraph(s); `subtopic(B).headingTrail` equals `['A']`.
  - Evidence: `src/core/domain/chunker.test.ts::A2_heading_hierarchy_and_trail(vitest)`

- [ ] **A3** — **Sibling order:** Under the same parent, children have `siblingOrder` 0..n-1 matching source order.
  - Evidence: `src/core/domain/chunker.test.ts::A3_sibling_order_matches_source(vitest)`

- [ ] **A4** — **Lists as bullets:** A list under a section produces `bullet` nodes with correct parent (section container or list nesting per CommonMark) and correct `headingTrail` matching sibling paragraphs in that section.
  - Evidence: `src/core/domain/chunker.test.ts::A4_list_items_are_bullets(vitest)`

- [ ] **A5** — **Frontmatter stripped:** Input with YAML frontmatter does not leak frontmatter into `paragraph`/`bullet` content; root `note` still created.
  - Evidence: `src/core/domain/chunker.test.ts::A5_frontmatter_stripped(vitest)`

- [ ] **A6** — **Deterministic contentHash:** For any emitted node, recomputing SHA-256 (or documented equivalent) over `content` matches `contentHash`; identical inputs produce identical hashes across runs.
  - Evidence: `src/core/domain/chunker.test.ts::A6_contenthash_stable(vitest)`

### Phase B: IDs and metadata

- [ ] **B1** — **Unique ids:** All `id` values in the returned array are unique strings (no duplicates).
  - Evidence: `src/core/domain/chunker.test.ts::B1_unique_ids(vitest)`

- [ ] **B2** — **Note root content:** The `note` node’s `content` equals `noteTitle` from input (trimmed per normal whitespace rules if documented).
  - Evidence: `src/core/domain/chunker.test.ts::B2_note_root_title(vitest)`

- [ ] **B3** — **Timestamps:** `createdAt` and `updatedAt` are non-empty ISO-8601 strings.
  - Evidence: `src/core/domain/chunker.test.ts::B3_iso_timestamps(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `src/core/**` contains no forbidden imports (Obsidian, native SQLite/WASM, adapter paths).
  - Verification: `npm run verify:core-imports` and `npm run check:boundaries` succeed after chunker lands.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` and `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** **Scoped regression (Epic 2 integrated):** For a **minimal** note—no Markdown lists and no paragraph that exceeds the embedding token threshold—the output **must not** contain `sentence_part` or `bullet_group`. Full `chunkNote` output **may** include those types when [CHK-2](CHK-2.md) (sentence split) or [CHK-3](CHK-3.md) (`bullet_group`) applies — this criterion does **not** forbid them globally.
  - Verification: Fixture with `# H` + short body, `maxEmbeddingTokens` at default/high; assert type set excludes `sentence_part` and `bullet_group`.
  - Evidence: `src/core/domain/chunker.test.ts::Y2_no_deferred_node_types_when_no_list_or_split(vitest)`

- [ ] **Y3** — **(binding)** Markdown parser dependency is declared in `package.json` and is not a native-only module (no `better-sqlite3`-class dependency for parsing).
  - Verification: Inspect `package.json` `dependencies` / `devDependencies`; `npm install` on clean tree succeeds.
  - Evidence: `package.json` lists parser package name; `npm ci` or `npm install` in CI/local log

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file under `src/core/domain/` (and `src/core/index.ts` if touched)
  - Evidence: ESLint on touched paths

- [ ] **Z4** — **N/A** — No `@shared/types` alias in this repo; imports use `src/core` paths per FND-3.

- [ ] **Z5** — Chunker does **not** write raw note Markdown or API keys to `console` or logger; failures surface as thrown errors (or documented empty tree only for empty `markdown` after strip—if empty input yields zero nodes, document that contract in JSDoc and test it).
  - Evidence: Code review + `src/core/domain/chunker.test.ts::Z5_no_content_logging(vitest)` (assert no `console.log` of input; or static grep `chunker.ts` for `console.`)

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Markdown edge cases (tables, HTML, footnotes) behave differently across parsers | Document supported subset in JSDoc; cover common Obsidian constructs in tests; upgrade parser in dependency story if needed. |
| 2 | Deferring `bullet_group` may complicate CHK-3 migration | Keep bullets as direct section children where needed; CHK-3 inserts group nodes and adjusts tests in that story. |
| 3 | Deterministic `contentHash` without stable `id` may hurt incremental matching | Prefer stable composite `id` scheme **or** document that WKF-3 will remap; minimum bar is unique ids + stable hashes in CHK-1. |

---

## Implementation Order

1. Add Markdown parser dependency to `package.json` (**Y3**).
2. Implement `stripFrontmatter` + AST walk in `chunker.ts` (**A5**, **Y8**).
3. Implement heading stack → `topic` / `subtopic` nodes with `headingTrail` / `depth` (**A2**, **Y4**, **Y6**).
4. Walk blocks → `paragraph` / `bullet` (**A4**, **Y3**).
5. Assign `siblingOrder`, compute `contentHash` (SHA-256 hex), set timestamps (**A3**, **A6**, **B3**).
6. Export from `src/core/index.ts` (**API**).
7. Write `chunker.test.ts` for Phases A, B, Y2, Z5 (**evidence**).
8. **Verify** — `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:core-imports`, `npm run check:boundaries` (**Z1**, **Y1**).

---

*Created: 2026-04-05 | Story: CHK-1 | Epic: 2 — Hierarchical chunking and note metadata*
