# HIER-3: Implement wikilink parser for cross-reference extraction

**Story**: Implement a wikilink parser utility that extracts `[[target]]` and `[[target|display]]` cross-references from node content, producing `CrossReference` records for storage in the hierarchical index.
**Epic**: Epic 11 — Hierarchical Document Model and Tree Chunker
**Size**: Small
**Status**: Open

---

## 1. Summary

This story delivers the wikilink parsing utility required by R9 (Cross-Reference Tracking) of the hierarchical indexing specification. Obsidian uses `[[wikilinks]]` as the primary mechanism for linking between notes. The parser must extract these links from node content, resolve the target path and optional display text, and produce `CrossReference` records that the tree chunker (HIER-5) will pass to storage.

The parser handles two wikilink forms: `[[target]]` (target path only) and `[[target|display text]]` (target path with display alias). It must correctly handle edge cases including wikilinks inside code fences (should be ignored), wikilinks with heading anchors (`[[note#heading]]`), and multiple wikilinks on the same line.

This is a standalone utility with no dependencies on other HIER stories. HIER-5 will call this parser during tree construction to extract cross-references from each node's content. The extracted `CrossReference` records use the type defined in HIER-1's `src/types.ts` additions.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The wikilink parser is a pure utility function. It uses the `CrossReference` type from `src/types.ts` (added by HIER-1):

```ts
import type { CrossReference } from "../types";

export function extractWikilinks(content: string, sourceNodeId: string): CrossReference[];
```

The function takes raw markdown content and the source node's ID, and returns an array of `CrossReference` objects. The `CrossReference` interface (from HIER-1) is:

```ts
export interface CrossReference {
  sourceNodeId: string;
  targetPath: string;
  targetDisplay: string | null;
}
```

No new types need to be added to `src/types.ts` for this story.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
HIER-5: HierarchicalChunker (future caller)
└── extractWikilinks(nodeContent, sourceNodeId)
    ├── scan for [[...]] patterns outside code fences
    ├── parse target path and optional display text
    ├── handle heading anchors ([[note#heading]])
    └── return CrossReference[]
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `extractWikilinks` | `(content: string, sourceNodeId: string) => CrossReference[]` | Stateless/pure | Core parser function; no side effects |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — pure synchronous function |
| Error   | Not applicable — function handles all edge cases gracefully |
| Empty   | Content with no wikilinks returns `[]` |
| Success | Returns `CrossReference[]` with one entry per unique wikilink found |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/utils/wikilinkParser.ts` | Wikilink extraction utility |
| 2 | `src/__tests__/unit/wikilinkParser.test.ts` | Unit tests for wikilink parsing edge cases |

### Files to MODIFY

None. This is a standalone utility with no modifications to existing files.

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — `CrossReference` type is added by HIER-1; no additional types needed
- `src/utils/chunker.ts` — existing flat chunker untouched; HIER-5 will integrate the parser
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/storage/vectorStoreSchema.ts` — `node_cross_refs` table is created by STOR-1
- `src/bootstrap/bootstrapRuntimeServices.ts` — no service wiring needed for a utility function

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Wikilink Extraction

- [ ] **A1** — Simple `[[target]]` wikilinks are extracted
  - Input `"See [[My Note]] for details."` returns one `CrossReference` with `targetPath: "My Note"` and `targetDisplay: null`.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::A1_simple_wikilink_extracted(vitest)`

- [ ] **A2** — Aliased `[[target|display]]` wikilinks are extracted
  - Input `"Refer to [[projects/roadmap|the roadmap]]."` returns one `CrossReference` with `targetPath: "projects/roadmap"` and `targetDisplay: "the roadmap"`.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::A2_aliased_wikilink_extracted(vitest)`

- [ ] **A3** — Multiple wikilinks on the same line are all extracted
  - Input `"Compare [[Note A]] with [[Note B|B]]."` returns two `CrossReference` records.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::A3_multiple_wikilinks_same_line(vitest)`

- [ ] **A4** — Multiple wikilinks across multiple lines are all extracted
  - Input spanning several lines with wikilinks on different lines returns all cross-references.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::A4_multiple_wikilinks_across_lines(vitest)`

### Phase B: Special Cases

- [ ] **B1** — Wikilinks with heading anchors are extracted with full target
  - Input `"See [[My Note#Section One]]."` returns `targetPath: "My Note#Section One"` (the anchor is part of the target path).
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::B1_heading_anchor_preserved(vitest)`

- [ ] **B2** — Wikilinks inside code fences are ignored
  - Wikilinks within `` ``` `` fenced code blocks are not extracted.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::B2_code_fence_wikilinks_ignored(vitest)`

- [ ] **B3** — Wikilinks inside inline code are ignored
  - Wikilinks within single backtick `` `[[target]]` `` inline code are not extracted.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::B3_inline_code_wikilinks_ignored(vitest)`

- [ ] **B4** — Duplicate wikilinks to the same target are deduplicated
  - If the same `[[target]]` appears multiple times, only one `CrossReference` is returned per unique `targetPath`.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::B4_duplicates_deduplicated(vitest)`

### Phase C: Edge Cases

- [ ] **C1** — Empty or whitespace-only content returns empty array
  - `extractWikilinks("", "node-1")` and `extractWikilinks("   ", "node-1")` both return `[]`.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::C1_empty_content_returns_empty(vitest)`

- [ ] **C2** — Content with no wikilinks returns empty array
  - Plain text without any `[[...]]` patterns returns `[]`.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::C2_no_wikilinks_returns_empty(vitest)`

- [ ] **C3** — Malformed wikilinks are ignored
  - Unclosed `[[target` or empty `[[]]` patterns are not extracted.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::C3_malformed_wikilinks_ignored(vitest)`

- [ ] **C4** — `sourceNodeId` is correctly set on all returned records
  - Every `CrossReference` in the output has `sourceNodeId` matching the input parameter.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::C4_source_node_id_set(vitest)`

- [ ] **C5** — Function is deterministic
  - Given identical input, repeated calls produce identical output.
  - Evidence: `src/__tests__/unit/wikilinkParser.test.ts::C5_deterministic_output(vitest)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Obsidian wikilink syntax has edge cases beyond `[[target]]` and `[[target\|display]]` (e.g., block references `[[note^block]]`, embedded files `![[image.png]]`) | MVP scope covers the two primary forms; embedded files and block references can be added in follow-up stories |
| 2 | Deduplication by `targetPath` may lose display text variants for the same target | The first display text encountered is kept; this is acceptable since cross-references are for retrieval expansion, not display |
| 3 | Code fence detection uses a simple toggle approach that may fail with nested fences | Nested code fences are rare in practice; the simple approach matches the existing chunker's code fence handling |
| 4 | The parser does not resolve vault-relative paths or validate that targets exist | Path resolution is a runtime concern handled during retrieval (META-2); the parser only extracts raw link text |

---

## Implementation Order

1. `src/utils/wikilinkParser.ts` — Implement `extractWikilinks` function with regex-based wikilink detection, code fence/inline code filtering, and deduplication (covers A1–A4, B1–B4, C1–C5)
2. **Verify** — `npm run typecheck` to confirm the new file compiles and `CrossReference` import resolves
3. `src/__tests__/unit/wikilinkParser.test.ts` — Write unit tests for all acceptance criteria (covers A1–C5)
4. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: HIER-3 | Epic: Epic 11 — Hierarchical Document Model and Tree Chunker*
