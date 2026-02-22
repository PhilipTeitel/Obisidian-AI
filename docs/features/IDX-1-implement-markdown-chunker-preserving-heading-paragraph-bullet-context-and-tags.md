# IDX-1: Implement markdown chunker preserving heading, paragraph/bullet context, and tags

**Story**: Implement a deterministic markdown chunker that converts note content into chunk records while preserving heading trail, paragraph/bullet context, and normalized tags for downstream embedding and search workflows.
**Epic**: Epic 2 — Indexing and Metadata Pipeline
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story delivers the first production-ready chunking primitive for the indexing pipeline: a utility that accepts a note path/title plus markdown content and returns `ChunkRecord[]` with stable metadata. The chunker must preserve note structure so search and chat can later recover meaningful context, not just raw text slices.

IDX-1 is the foundation dependency for IDX-2 (vault crawler), IDX-3 (full reindex), and IDX-4 (incremental indexing). Those stories need a trustworthy transformation from markdown document -> structured chunk records before they can focus on traversal, persistence, and update detection.

The key design constraint is deterministic chunk identity and metadata quality. For a given note content and timestamp input, chunk boundaries and metadata should be reproducible so later stories can safely hash content, compare changes, and emit stable progress/reporting behavior.

Implementation should remain scoped to parsing and normalization logic (including tests), without introducing crawler or storage behavior that belongs to later indexing stories.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin and does not use `shared/types.ts`; type updates for IDX-1 should be made in `src/types.ts`.

The following NEW or CHANGED interfaces/types should be added to support chunker output semantics:

```ts
export type ChunkContextKind = "paragraph" | "bullet";

export interface ChunkReference {
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  blockRef?: string;
  tags: string[];
  contextKind?: ChunkContextKind; // identifies whether source text came from paragraph or bullet
}

export interface ChunkerInput {
  notePath: string;
  noteTitle: string;
  markdown: string;
  updatedAt: number;
}

export interface ChunkerOptions {
  maxChunkChars?: number;
}
```

`ChunkRecord` should remain the canonical persisted chunk shape; IDX-1 should avoid introducing a parallel chunk output type unless there is a strong reason.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
IndexingService (future caller in IDX-3/IDX-4)
└── chunkMarkdownNote(input, options) in src/utils/chunker.ts
    ├── parse heading trail (#, ##, ###, ...)
    ├── split prose blocks into paragraph chunks
    ├── split list items into bullet chunks
    ├── extract + normalize tags (frontmatter + inline)
    └── emit ChunkRecord[] with deterministic ids/hashes
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `chunkMarkdownNote` | `(input: ChunkerInput, options?: ChunkerOptions) => ChunkRecord[]` | Stateless/pure | Core parser function; no vault I/O, provider calls, or global mutable state |
| `extractTagsFromMarkdown` | `(markdown: string) => string[]` | Stateless/pure | Returns normalized, deduped tags merged from frontmatter and inline tags |
| `ChunkReference.contextKind` | `"paragraph" \| "bullet"` | N/A | Preserves minimum paragraph/bullet provenance required by IDX-1 scope |
| `ChunkRecord.id` generation | deterministic from `notePath + headingTrail + blockRef + content` | N/A | Stable identity needed for later incremental workflows |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable in UI for IDX-1; parser is synchronous/pure and invoked by indexing services |
| Error   | Invalid parse conditions (if any) are surfaced as typed runtime errors or explicit throw paths tested in unit tests |
| Empty   | Empty markdown or markdown without chunkable paragraph/bullet content returns `[]` |
| Success | Markdown note produces one or more `ChunkRecord` entries with heading trail, context kind, and normalized tags |

No frontend component/view changes are required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/utils/chunker.ts` | Implement deterministic markdown chunk parsing for heading, paragraph/bullet context, tag extraction, and chunk assembly |
| 2 | `src/__tests__/unit/chunker.test.ts` | Unit tests for heading trail handling, paragraph vs bullet chunking, tag normalization, and deterministic chunk identity |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add chunker input/options and (if needed) `ChunkContextKind` metadata on `ChunkReference` |
| 2 | `src/services/IndexingService.ts` | Add import-level integration seam and TODO-scoped usage hook so later stories can wire crawler outputs into chunker without refactor |
| 3 | `src/__tests__/smoke.test.ts` | Add compile-safe assertions for new chunker-related exported types/contracts |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — search retrieval/ranking behavior is out of scope for IDX-1
- `src/services/ChatService.ts` — chat orchestration does not change in this indexing-only story
- `src/main.ts` — command wiring and UI shell behavior should remain unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Chunking Engine

- [x] **A1** — Chunker entrypoint exists with deterministic, pure contract
  - `src/utils/chunker.ts` exports `chunkMarkdownNote(input, options?) => ChunkRecord[]` without Obsidian API or provider dependencies.
  - Given identical input, the function returns identical chunk boundaries, IDs, and metadata ordering.

- [x] **A2** — Heading trail is preserved for every emitted chunk
  - Chunks beneath nested headings include full `headingTrail` in source order (e.g., `["Project", "Decisions"]`).
  - Content before the first heading is still chunked with an empty `headingTrail`.

- [x] **A3** — Paragraph and bullet contexts are preserved distinctly
  - Prose paragraphs and list bullets are emitted as separate chunks when both appear in a section.
  - Each chunk includes a metadata indicator (for example `contextKind`) identifying paragraph vs bullet provenance.

### Phase B: Tag Extraction and Normalization

- [x] **B1** — Frontmatter tags are extracted from common formats
  - `tags: [a, b]`, `tags: ["a", "b"]`, and single-string frontmatter tag forms are parsed into normalized tag arrays.
  - Invalid/empty tag entries are ignored without throwing.

- [x] **B2** — Inline markdown tags are extracted and merged
  - Inline tags matching Obsidian-style `#tag` syntax are detected from chunkable markdown content.
  - Frontmatter and inline tags are merged, normalized (trimmed, lowercase), and deduplicated.

- [x] **B3** — Chunk-level tags remain stable and complete
  - Every chunk includes the merged note-level tag set in `source.tags`.
  - Tag output ordering is deterministic (for example lexical ascending) to avoid noisy diffs in later stories.

### Phase C: Type and Test Coverage

- [x] **C1** — Type contracts for chunker inputs/outputs are explicit
  - `src/types.ts` exports all new chunker-related types used by parser and callers.
  - No `any` is introduced in chunker implementation or tests.

- [x] **C2** — Unit tests cover critical markdown edge cases
  - Tests cover: no heading content, nested headings, mixed paragraph+bullet sections, blank lines, and repeated tags.
  - At least one test verifies deterministic IDs/hashes across repeated invocations.

- [x] **C3** — Story scope remains parser-only
  - No vault crawling, embedding provider calls, or vector-store persistence is implemented in IDX-1.
  - Any integration seam in `IndexingService` is non-invasive and does not change external command behavior.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Markdown grammar edge cases (nested lists, code fences, callouts) can cause incorrect chunk boundaries | Start with deterministic MVP rules documented in tests; explicitly skip/ignore unsupported blocks rather than silently misclassifying |
| 2 | Tag extraction from frontmatter without full YAML parser may be brittle | Support only targeted `tags` forms in IDX-1, add strict tests, and defer richer YAML handling to follow-up if required |
| 3 | Adding new metadata fields to `ChunkReference` can impact downstream type consumers | Make additions optional where possible and update smoke tests to keep compile safety |
| 4 | Deterministic ID strategy may conflict with later hash/update workflow decisions | Base IDs on stable source attributes + content hash and document strategy so IDX-4 can reuse it without refactor |

---

## Implementation Order

1. `src/types.ts` — add `ChunkContextKind`, `ChunkerInput`, and `ChunkerOptions` plus any `ChunkReference` extension needed for paragraph/bullet provenance (covers A3, C1).
2. `src/utils/chunker.ts` — implement heading tracking, paragraph/list block segmentation, tag extraction/normalization helpers, and deterministic chunk assembly (covers A1, A2, A3, B1, B2, B3).
3. `src/__tests__/unit/chunker.test.ts` — add focused parser tests for structural + tag edge cases and deterministic identity assertions (covers C2, A2, A3, B1, B2, B3).
4. `src/services/IndexingService.ts` — add a minimal integration seam (import + TODO usage point) without introducing crawler/storage behavior (covers C3).
5. `src/__tests__/smoke.test.ts` — add compile-safe type assertions for new chunker contracts (covers C1).
6. **Verify** — run `npm run test`, `npm run lint`, and `npm run typecheck` to validate parser correctness and typing (covers Z2, Z3).
7. **Final verify** — run `npm run build` and confirm no command/UI behavior changed outside indexing parser groundwork (covers Z1, Z4).

---

*Created: 2026-02-22 | Story: IDX-1 | Epic: Epic 2 — Indexing and Metadata Pipeline*
