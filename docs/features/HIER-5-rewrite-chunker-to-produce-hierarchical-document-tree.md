# HIER-5: Rewrite chunker to produce hierarchical document tree

**Story**: Completely rewrite the markdown chunker to produce a hierarchical `DocumentTree` of typed nodes (note → topic → subtopic → paragraph/bullet_group → bullet) with sentence-boundary splitting, bullet grouping, scoped tag tracking, and cross-reference extraction.
**Epic**: Epic 11 — Hierarchical Document Model and Tree Chunker
**Size**: Large
**Status**: Open

---

## 1. Summary

This story is the centerpiece of Epic 11 and delivers the core transformation from flat chunk output to a hierarchical document tree, implementing requirements R1 (Hierarchical Document Model), R3 (Paragraph Splitting by Sentence), R4 (Bullet List Semantic Grouping), and R8 (Scoped Tag Tracking). The rewritten chunker replaces the existing `chunkMarkdownNote` function with a new `buildDocumentTree` function that produces a `DocumentTree` — a tree of `DocumentNode` instances with full metadata.

The rewrite preserves the existing flat chunker's exports so that the current pipeline continues to work until the integration epic (Epic 15) switches over. The new hierarchical chunker is exported as a separate function alongside the existing one. The existing `chunkMarkdownNote` function, `extractTagsFromMarkdown`, and all helper functions remain in the file and continue to compile.

The chunker depends on all four preceding HIER stories: HIER-1 (node types), HIER-2 (sentence splitter for long paragraphs), HIER-3 (wikilink parser for cross-references), and HIER-4 (token estimator for optional node token estimates). It reuses the existing frontmatter parser and tag extraction logic already present in `chunker.ts`, extending them with scoped tag tracking (tags are inherited from note level and augmented with inline tags per node scope).

The key design principles are: (1) the tree structure must faithfully represent the markdown document's heading hierarchy, bullet nesting, and paragraph boundaries; (2) node IDs must be stable across re-indexes using the FNV-1a hash of `notePath|headingTrail|nodeType|sequenceIndex|contentPrefix`; (3) the `DocumentTree.nodes` Map must contain every node in the tree for O(1) lookup; and (4) the existing flat chunker exports must remain functional.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The new hierarchical chunker function signature:

```ts
import type { DocumentTree, DocumentNode, NodeType, ChunkerInput } from "../types";

export interface HierarchicalChunkerOptions {
  maxParagraphChars?: number;
}

export function buildDocumentTree(
  input: ChunkerInput,
  options?: HierarchicalChunkerOptions
): DocumentTree;
```

The function uses the `ChunkerInput` type already defined in `src/types.ts` (same input as the flat chunker) and returns a `DocumentTree` (from HIER-1). The `HierarchicalChunkerOptions` interface is local to the chunker file.

No new types need to be added to `src/types.ts` — all required types (`DocumentNode`, `DocumentTree`, `NodeType`, `CrossReference`) are defined by HIER-1.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
buildDocumentTree(input, options)
├── parseFrontmatter(markdown) → { body, tags }     [existing, reused]
├── extractInlineTags(body) → string[]               [existing, reused]
├── createNoteRootNode(input, frontmatterTags)
│   └── DocumentNode { nodeType: "note", depth: 0 }
├── parseBodyLines(bodyLines, rootNode, options)
│   ├── on # heading → createTopicNode()
│   │   └── DocumentNode { nodeType: "topic", depth: 1 }
│   ├── on ## through ###### heading → createSubtopicNode()
│   │   └── DocumentNode { nodeType: "subtopic", depth: 2+ }
│   ├── on bullet line → startOrContinueBulletGroup()
│   │   ├── createBulletGroupNode()
│   │   │   └── DocumentNode { nodeType: "bullet_group" }
│   │   └── createBulletNode(indent, content)
│   │       ├── DocumentNode { nodeType: "bullet" }
│   │       └── sub-bullets → nested createBulletNode()
│   ├── on paragraph lines → flushParagraph()
│   │   ├── short paragraph → single DocumentNode { nodeType: "paragraph" }
│   │   └── long paragraph → splitBySentence() → multiple paragraph nodes
│   │       └── each with sequenceIndex 0, 1, 2, ...
│   └── on blank line → flush current context
├── extractWikilinks(content, nodeId) → CrossReference[]  [from HIER-3]
├── computeNodeId(notePath, headingTrail, nodeType, sequenceIndex, contentPrefix)
│   └── stableHash() using FNV-1a
└── assembleDocumentTree(rootNode, allNodes) → DocumentTree
    └── { root, nodes: Map<string, DocumentNode> }
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `buildDocumentTree` | `(input: ChunkerInput, options?: HierarchicalChunkerOptions) => DocumentTree` | Stateless/pure | Main entry point for hierarchical chunking |
| `HierarchicalChunkerOptions` | `{ maxParagraphChars?: number }` | N/A | Controls when long paragraphs are sentence-split |
| `parseFrontmatter` | `(markdown: string) => FrontmatterParseResult` | Stateless/pure | Reused from existing chunker; extracts body and frontmatter tags |
| `extractInlineTags` | `(body: string) => string[]` | Stateless/pure | Reused from existing chunker; extracts inline `#tag` patterns |
| `splitBySentence` | `(content: string, maxChunkChars: number) => SentenceSplit[]` | Stateless/pure | From HIER-2; used for long paragraph splitting |
| `extractWikilinks` | `(content: string, sourceNodeId: string) => CrossReference[]` | Stateless/pure | From HIER-3; used for cross-reference extraction |
| `estimateTokens` | `(text: string) => number` | Stateless/pure | From HIER-4; optional token estimate on nodes |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — pure synchronous function |
| Error   | Not applicable — function handles all edge cases gracefully |
| Empty   | Empty markdown returns a `DocumentTree` with only a root note node (no children) |
| Success | Returns a `DocumentTree` with root node and all descendant nodes in the `nodes` Map |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/hierarchicalChunker.test.ts` | Comprehensive unit tests for tree structure, bullet grouping, paragraph splitting, tag scoping, cross-references, and edge cases |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/utils/chunker.ts` | Add `buildDocumentTree` function and `HierarchicalChunkerOptions` interface alongside existing flat chunker exports. Add imports for `splitBySentence`, `extractWikilinks`, `estimateTokens`, and hierarchical types. Existing exports (`chunkMarkdownNote`, `extractTagsFromMarkdown`) remain unchanged. |

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — all required types are defined by HIER-1
- `src/utils/sentenceSplitter.ts` — consumed as-is from HIER-2
- `src/utils/wikilinkParser.ts` — consumed as-is from HIER-3
- `src/utils/tokenEstimator.ts` — consumed as-is from HIER-4
- `src/utils/hasher.ts` — the chunker uses its own internal `stableHash` (FNV-1a); `hasher.ts` is for content hashing
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/storage/LocalVectorStoreRepository.ts` — existing flat store remains functional
- `src/bootstrap/bootstrapRuntimeServices.ts` — no service wiring needed for a utility function
- `src/__tests__/unit/chunker.test.ts` — existing flat chunker tests remain and must continue to pass

---

## 5. Acceptance Criteria Checklist

### Phase A: Tree Structure and Node Types

- [ ] **A1** — `buildDocumentTree` returns a `DocumentTree` with a root note node
  - The root node has `nodeType: "note"`, `depth: 0`, `parentId: null`, and `content` equal to the full note title.
  - The `DocumentTree.nodes` Map contains the root and all descendants.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::A1_root_note_node(vitest)`

- [ ] **A2** — `#` headings produce `topic` nodes at depth 1
  - A `# Heading` line creates a `DocumentNode` with `nodeType: "topic"`, `depth: 1`, `headingTrail: ["Heading"]`, and `parentId` pointing to the note root.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::A2_topic_nodes_from_h1(vitest)`

- [ ] **A3** — `##` through `######` headings produce `subtopic` nodes at appropriate depths
  - A `## Sub` under `# Main` creates a subtopic with `depth: 2`, `headingTrail: ["Main", "Sub"]`, and `parentId` pointing to the topic node.
  - Deeper headings (`###`, `####`, etc.) nest correctly with incrementing depth.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::A3_subtopic_nodes_from_h2_through_h6(vitest)`

- [ ] **A4** — Content before the first heading is attached to the note root
  - Paragraphs and bullets before any heading become children of the root note node.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::A4_content_before_first_heading(vitest)`

- [ ] **A5** — All nodes have stable, deterministic `nodeId` values
  - The `nodeId` is computed as FNV-1a hash of `notePath|headingTrail|nodeType|sequenceIndex|contentPrefix`.
  - Given identical input, repeated calls produce identical `nodeId` values for all nodes.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::A5_stable_deterministic_node_ids(vitest)`

- [ ] **A6** — Parent-child relationships are bidirectional and consistent
  - Every node's `parentId` points to a valid node in the tree (except root which is `null`).
  - Every node's `childIds` array contains IDs of nodes whose `parentId` matches.
  - The `nodes` Map contains every node referenced by any `parentId` or `childIds`.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::A6_bidirectional_parent_child(vitest)`

### Phase B: Paragraph Handling (R3)

- [ ] **B1** — Contiguous non-blank, non-heading, non-bullet lines form paragraph nodes
  - A block of plain text lines (separated by blank lines from other content) becomes a single `paragraph` node.
  - The paragraph's `content` is the full text (not truncated).
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::B1_paragraph_node_from_text_block(vitest)`

- [ ] **B2** — Long paragraphs are split at sentence boundaries
  - When a paragraph exceeds `maxParagraphChars`, it is split using `splitBySentence` from HIER-2.
  - Each split produces a separate `paragraph` node with the same `parentId` and incrementing `sequenceIndex`.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::B2_long_paragraph_sentence_split(vitest)`

- [ ] **B3** — Split paragraph nodes can be reassembled by `sequenceIndex`
  - Collecting all paragraph nodes with the same `parentId` and sorting by `sequenceIndex` reproduces the original paragraph content (modulo whitespace normalization).
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::B3_split_paragraph_reassembly(vitest)`

### Phase C: Bullet List Grouping (R4)

- [ ] **C1** — Consecutive bullets with no blank line form a `bullet_group` node
  - A sequence of `- item` lines without blank lines between them creates a `bullet_group` parent with individual `bullet` children.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::C1_bullet_group_from_consecutive_bullets(vitest)`

- [ ] **C2** — Blank lines between bullets create separate `bullet_group` nodes
  - Two bullet sequences separated by a blank line produce two distinct `bullet_group` nodes.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::C2_blank_line_separates_bullet_groups(vitest)`

- [ ] **C3** — Sub-bullets (indented) become children of their parent bullet
  - Indented bullets (tab or 2+ spaces) under a top-level bullet become children of that bullet node, forming a nested tree.
  - The parent bullet's `childIds` contains the sub-bullet IDs.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::C3_sub_bullets_nested(vitest)`

- [ ] **C4** — Bullet markers `- `, `* `, `+ `, and `1. ` are all recognized
  - All standard markdown bullet markers produce bullet nodes.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::C4_all_bullet_markers_recognized(vitest)`

- [ ] **C5** — `bullet_group` content is the concatenation of all child bullet content
  - The `bullet_group` node's `content` field contains the full text of all its bullets (for summary generation).
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::C5_bullet_group_content_concatenation(vitest)`

### Phase D: Scoped Tag Tracking (R8)

- [ ] **D1** — Frontmatter tags are inherited by all nodes in the tree
  - Tags from YAML frontmatter appear in the `tags` array of every node in the tree.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::D1_frontmatter_tags_inherited(vitest)`

- [ ] **D2** — Inline tags are scoped to the node where they appear
  - An inline `#tag` within a paragraph or bullet is added to that node's `tags` array (in addition to inherited frontmatter tags).
  - Sibling nodes without that inline tag do not include it.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::D2_inline_tags_scoped(vitest)`

- [ ] **D3** — Tags are normalized, deduplicated, and sorted
  - Tags are lowercased, trimmed, deduplicated, and sorted alphabetically — matching the existing chunker's tag normalization behavior.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::D3_tags_normalized_deduped_sorted(vitest)`

### Phase E: Cross-Reference Extraction (R9)

- [ ] **E1** — Wikilinks in node content are extracted as `CrossReference` records
  - The chunker calls `extractWikilinks` from HIER-3 for each node's content.
  - Cross-references are collected and available for storage by the caller.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::E1_wikilinks_extracted(vitest)`

### Phase F: Content Hash and Metadata

- [ ] **F1** — Each node has a `contentHash` for change detection
  - The `contentHash` is computed from the node's `content` using the FNV-1a hash.
  - Changed content produces a different hash; identical content produces the same hash.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::F1_content_hash_change_detection(vitest)`

- [ ] **F2** — Each node has `sequenceIndex` for sibling ordering
  - Children of the same parent are assigned `sequenceIndex` values (0, 1, 2, ...) in document order.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::F2_sequence_index_ordering(vitest)`

- [ ] **F3** — Each node has `updatedAt` from the input
  - All nodes in the tree carry the `updatedAt` timestamp from the `ChunkerInput`.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::F3_updated_at_propagated(vitest)`

### Phase G: Backward Compatibility

- [ ] **G1** — Existing `chunkMarkdownNote` function remains exported and functional
  - The existing flat chunker function continues to work identically.
  - All existing `chunker.test.ts` tests continue to pass without modification.
  - Evidence: `src/__tests__/unit/chunker.test.ts::all_existing_tests_pass(vitest)`

- [ ] **G2** — Existing `extractTagsFromMarkdown` function remains exported and functional
  - The tag extraction utility continues to work identically.
  - Evidence: `src/__tests__/unit/chunker.test.ts::all_existing_tests_pass(vitest)`

### Phase H: Edge Cases

- [ ] **H1** — Empty markdown produces a tree with only a root note node
  - Empty or whitespace-only markdown returns a `DocumentTree` where the root has no children.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::H1_empty_markdown_root_only(vitest)`

- [ ] **H2** — Markdown with no headings produces flat children under root
  - All paragraphs and bullet groups become direct children of the note root.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::H2_no_headings_flat_under_root(vitest)`

- [ ] **H3** — Code fences are treated as paragraph content, not parsed for structure
  - Content inside `` ``` `` fences is not parsed for headings, bullets, or tags.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::H3_code_fences_as_paragraph(vitest)`

- [ ] **H4** — Mixed content (headings, paragraphs, bullets) produces correct tree
  - A complex note with interleaved headings, paragraphs, and bullet lists produces the expected tree structure with correct parent-child relationships.
  - Evidence: `src/__tests__/unit/hierarchicalChunker.test.ts::H4_mixed_content_correct_tree(vitest)`

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
| 1 | Complete rewrite of chunker is high-risk for regressions | Existing flat chunker exports are preserved and tested; new function is additive. All existing tests must continue to pass. |
| 2 | Heading level jumps (e.g., `#` → `###` skipping `##`) could produce unexpected tree depth | Treat any heading level > 1 as a subtopic; depth is determined by the heading level relative to the current context, not absolute level |
| 3 | Deeply nested bullet lists (4+ levels) could produce very deep trees | The tree faithfully represents the document structure; depth is bounded by the markdown content itself |
| 4 | The `bullet_group` content concatenation may produce large content strings | This is by design — the content is used for summary generation (SUM-1) and is not truncated |
| 5 | Scoped tag tracking adds complexity to the parsing loop | Tags are tracked via a simple scope stack that mirrors the heading/node hierarchy; the existing tag extraction logic is reused |
| 6 | Cross-reference extraction adds a dependency on HIER-3 | The dependency is a pure function call with no side effects; if HIER-3 is not yet complete, cross-reference extraction can be stubbed |
| 7 | `DocumentTree.nodes` Map could be large for very long notes | The Map is proportional to the number of structural elements in the note, not raw character count; even a 10,000-word note typically has < 200 nodes |

---

## Implementation Order

1. `src/utils/chunker.ts` — Add imports for `splitBySentence`, `extractWikilinks`, `estimateTokens`, and hierarchical types from HIER-1 through HIER-4 (covers setup)
2. `src/utils/chunker.ts` — Implement `HierarchicalChunkerOptions` interface and internal helper functions: `createNode`, `computeNodeId`, heading level tracking, and scope stack for tags (covers A1, A5, D1)
3. `src/utils/chunker.ts` — Implement heading parsing: `#` → topic nodes, `##`–`######` → subtopic nodes with correct depth and heading trail (covers A2, A3, A4)
4. `src/utils/chunker.ts` — Implement paragraph handling: contiguous text → paragraph nodes, long paragraphs → sentence-split paragraph nodes with `sequenceIndex` (covers B1, B2, B3)
5. `src/utils/chunker.ts` — Implement bullet list handling: consecutive bullets → `bullet_group` with `bullet` children, indented bullets → nested children (covers C1, C2, C3, C4, C5)
6. `src/utils/chunker.ts` — Implement scoped tag tracking and cross-reference extraction (covers D1, D2, D3, E1)
7. `src/utils/chunker.ts` — Implement `buildDocumentTree` entry point: assemble tree, compute content hashes, set metadata, return `DocumentTree` (covers A6, F1, F2, F3)
8. **Verify** — `npm run typecheck && npm run build` to confirm compilation; run existing `chunker.test.ts` to confirm backward compatibility (covers G1, G2)
9. `src/__tests__/unit/hierarchicalChunker.test.ts` — Write comprehensive tests for all acceptance criteria (covers A1–H4)
10. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: HIER-5 | Epic: Epic 11 — Hierarchical Document Model and Tree Chunker*
