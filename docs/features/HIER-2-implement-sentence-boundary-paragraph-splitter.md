# HIER-2: Implement sentence-boundary paragraph splitter

**Story**: Implement a sentence-boundary splitter utility that splits long paragraphs at sentence boundaries instead of arbitrary word boundaries, producing ordered chunks with `sequenceIndex` for reassembly.
**Epic**: Epic 11 — Hierarchical Document Model and Tree Chunker
**Size**: Small
**Status**: Complete

---

## 1. Summary

This story delivers the sentence-boundary paragraph splitting utility required by R3 of the hierarchical indexing specification. The current flat chunker (`src/utils/chunker.ts`) splits oversized paragraphs at word boundaries using `splitByMaxChunkChars`, which can break mid-sentence and produce semantically incomplete chunks. The new `sentenceSplitter.ts` replaces this approach with sentence-aware splitting that preserves meaning within each chunk.

The splitter must handle common English abbreviations (Mr., Dr., Mrs., Prof., e.g., i.e., etc., vs., approx.), decimal numbers (3.14, $1.50), URLs (https://example.com), and ellipses (...) without incorrectly treating them as sentence boundaries. Each split chunk carries a `sequenceIndex` (0, 1, 2, ...) so the full paragraph can be reassembled in order via `parentId` + `sequenceIndex` in the hierarchical model.

HIER-5 (the tree chunker rewrite) is the primary consumer of this utility. It will call the sentence splitter when a paragraph node exceeds the configured chunk size limit. The splitter is a pure, stateless function with no dependencies on Obsidian APIs, providers, or storage — only on the `DocumentNode` type from HIER-1 for the return shape.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The sentence splitter is a pure utility function. No new types need to be added to `src/types.ts` — the function operates on plain strings and returns `SentenceSplit[]`, a local interface defined within the utility file:

```ts
export interface SentenceSplit {
  text: string;
  sequenceIndex: number;
}

export function splitBySentence(content: string, maxChunkChars: number): SentenceSplit[];
```

The `SentenceSplit` interface is intentionally lightweight and local to the utility. The tree chunker (HIER-5) will map these splits into `DocumentNode` instances using the `sequenceIndex` field.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
HIER-5: HierarchicalChunker (future caller)
└── splitBySentence(paragraphContent, maxChunkChars)
    ├── detect sentence boundaries via regex
    ├── handle abbreviations, decimals, URLs, ellipses
    ├── accumulate sentences into chunks up to maxChunkChars
    └── return SentenceSplit[] with sequenceIndex
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `splitBySentence` | `(content: string, maxChunkChars: number) => SentenceSplit[]` | Stateless/pure | Core splitter function; no side effects |
| `SentenceSplit` | `{ text: string; sequenceIndex: number }` | N/A | Lightweight output record for each split chunk |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — pure synchronous function |
| Error   | Not applicable — function handles all edge cases gracefully |
| Empty   | Empty or whitespace-only input returns `[]` |
| Success | Returns ordered `SentenceSplit[]` where each chunk respects `maxChunkChars` |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/utils/sentenceSplitter.ts` | Sentence-boundary paragraph splitting utility |
| 2 | `src/__tests__/unit/sentenceSplitter.test.ts` | Unit tests covering abbreviations, decimals, URLs, ellipses, long sentences, and edge cases |

### Files to MODIFY

None. This is a standalone utility with no modifications to existing files.

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — no new shared types needed; `SentenceSplit` is local to the utility
- `src/utils/chunker.ts` — existing flat chunker untouched; HIER-5 will integrate the splitter
- `src/utils/hasher.ts` — no changes to hashing utilities
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/bootstrap/bootstrapRuntimeServices.ts` — no service wiring needed for a utility function

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Sentence Splitting

- [x] **A1** — `splitBySentence` splits at sentence-ending punctuation
  - Sentences ending with `.`, `!`, or `?` followed by whitespace are treated as boundaries.
  - Input `"First sentence. Second sentence. Third sentence."` with `maxChunkChars` large enough returns a single chunk.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::A1_splits_at_sentence_boundaries(vitest)`

- [x] **A2** — Chunks respect `maxChunkChars` limit
  - When accumulated sentences exceed `maxChunkChars`, a new chunk is started at the next sentence boundary.
  - No chunk exceeds `maxChunkChars` unless a single sentence is longer than the limit (in which case it becomes its own chunk).
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::A2_respects_max_chunk_chars(vitest)`

- [x] **A3** — Each chunk carries a sequential `sequenceIndex`
  - The first chunk has `sequenceIndex: 0`, second has `1`, etc.
  - Reassembling chunks by `sequenceIndex` order reproduces the original content (modulo whitespace normalization).
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::A3_sequential_index_ordering(vitest)`

### Phase B: Abbreviation and Special Case Handling

- [x] **B1** — Common abbreviations do not trigger false splits
  - Abbreviations `Mr.`, `Mrs.`, `Dr.`, `Prof.`, `e.g.`, `i.e.`, `etc.`, `vs.`, `approx.`, `Jr.`, `Sr.`, `St.`, `Mt.`, `Dept.`, `Corp.`, `Inc.`, `Ltd.` are not treated as sentence boundaries.
  - Input `"Dr. Smith met Mr. Jones at 3 p.m. today."` remains a single sentence.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::B1_abbreviations_not_split(vitest)`

- [x] **B2** — Decimal numbers do not trigger false splits
  - Numbers like `3.14`, `$1.50`, `0.001`, and `v2.0` are not treated as sentence boundaries.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::B2_decimals_not_split(vitest)`

- [x] **B3** — URLs do not trigger false splits
  - URLs like `https://example.com/path.html` and `ftp://files.server.org` are not split at internal periods.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::B3_urls_not_split(vitest)`

- [x] **B4** — Ellipses are handled correctly
  - `...` (three dots) is not treated as three sentence boundaries.
  - Text like `"He paused... then continued."` is treated as one or two sentences, not four.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::B4_ellipses_handled(vitest)`

### Phase C: Edge Cases

- [x] **C1** — Empty or whitespace-only input returns empty array
  - `splitBySentence("", 500)` and `splitBySentence("   \n  ", 500)` both return `[]`.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::C1_empty_input_returns_empty(vitest)`

- [x] **C2** — Content shorter than `maxChunkChars` returns single chunk
  - A short paragraph that fits within the limit returns exactly one `SentenceSplit` with `sequenceIndex: 0`.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::C2_short_content_single_chunk(vitest)`

- [x] **C3** — Single sentence longer than `maxChunkChars` is not split mid-sentence
  - A single very long sentence exceeding the limit is returned as one chunk (the sentence boundary takes priority over the size limit).
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::C3_long_sentence_not_split(vitest)`

- [x] **C4** — Function is deterministic
  - Given identical input, repeated calls produce identical output.
  - Evidence: `src/__tests__/unit/sentenceSplitter.test.ts::C4_deterministic_output(vitest)`

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
| 1 | Regex-based sentence detection cannot handle all natural language edge cases (e.g., quoted speech, nested abbreviations) | Focus on common English patterns; document known limitations; the hierarchical model's reassembly capability means imperfect splits are recoverable |
| 2 | Abbreviation list may be incomplete for non-English content | Start with comprehensive English abbreviations; the list is easily extensible without API changes |
| 3 | A single sentence longer than `maxChunkChars` produces an oversized chunk | This is by design — splitting mid-sentence would degrade embedding quality. The hierarchical model handles context via parent summaries |
| 4 | No overlap between split chunks | Overlap is explicitly rejected per R3 rationale — the hierarchical model supports reassembly via `parentId` + `sequenceIndex` |

---

## Implementation Order

1. `src/utils/sentenceSplitter.ts` — Implement `SentenceSplit` interface and `splitBySentence` function with abbreviation-aware regex (covers A1, A2, A3, B1, B2, B3, B4)
2. **Verify** — `npm run typecheck` to confirm the new file compiles
3. `src/__tests__/unit/sentenceSplitter.test.ts` — Write unit tests for all acceptance criteria (covers A1–C4)
4. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: HIER-2 | Epic: Epic 11 — Hierarchical Document Model and Tree Chunker*
