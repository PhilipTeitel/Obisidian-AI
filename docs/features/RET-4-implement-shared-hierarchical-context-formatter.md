# RET-4: Implement shared hierarchical context formatter

**Story**: Create `src/utils/contextFormatter.ts` with a `formatHierarchicalContext` function that formats `AssembledContext` into a structured text representation preserving document hierarchy, used by both chat providers.
**Epic**: Epic 14 — Three-Phase Hierarchical Retrieval
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story delivers the shared hierarchical context formatting utility described in requirement R7. The `formatHierarchicalContext` function takes `HierarchicalContextBlock[]` from the `AssembledContext` and produces a structured text string that preserves document hierarchy (headings, summaries, bullets, paragraphs).

The formatted output replaces the flat `[N] notePath (heading)\nsnippet` format currently used by both `OpenAIChatProvider` and `OllamaChatProvider`. Both providers will consume this shared utility (wiring happens in RET-5).

Format:

```
Source: notePath
# Topic Heading
Summary: <topic summary>

## Subtopic Heading
<full paragraph text>

- Bullet 1
  - Sub-bullet 1a
```

Key design decisions:
- **Shared utility**: Both providers use the same formatting function to ensure consistent context presentation.
- **Heading trail rendering**: Heading trail entries are rendered as markdown headings at appropriate levels.
- **Summary inclusion**: Parent summaries are included as `Summary: <text>` lines.
- **Sibling context**: Sibling content is included as additional context within the same section.
- **Score annotation**: Each block includes a relevance score for transparency.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. New utility function:

```ts
export const formatHierarchicalContext = (blocks: HierarchicalContextBlock[]): string;
```

---

## 3. Frontend Flow

No frontend components. Consumed by chat providers.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/utils/contextFormatter.ts` | Shared hierarchical context formatting utility |
| 2 | `src/__tests__/unit/contextFormatter.test.ts` | Unit tests for context formatting |

---

## 5. Acceptance Criteria Checklist

### Phase A: Formatting Logic

- [x] **A1** — `formatHierarchicalContext` produces structured output with source path
  - Each block starts with `Source: <notePath>`.
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::A1_source_path(vitest)`

- [x] **A2** — Heading trail entries are rendered as markdown headings
  - First entry as `#`, second as `##`, etc.
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::A2_heading_trail(vitest)`

- [x] **A3** — Parent summary is rendered as `Summary: <text>`
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::A3_parent_summary(vitest)`

- [x] **A4** — Matched content is included as the main body
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::A4_matched_content(vitest)`

- [x] **A5** — Sibling content is included as additional context
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::A5_sibling_content(vitest)`

- [x] **A6** — Multiple blocks are separated by double newlines
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::A6_multiple_blocks(vitest)`

### Phase B: Edge Cases

- [x] **B1** — Empty blocks array returns empty string
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::B1_empty_blocks(vitest)`

- [x] **B2** — Blocks with empty heading trail omit heading lines
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::B2_no_heading_trail(vitest)`

- [x] **B3** — Blocks with empty parent summary omit summary line
  - Evidence: `src/__tests__/unit/contextFormatter.test.ts::B3_no_parent_summary(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes (or only pre-existing warnings)
- [x] **Z3** — No `any` types
- [x] **Z4** — All existing tests continue to pass

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Formatting is opinionated and may need tuning | Simple text format is easy to adjust; no complex serialization |

---

*Created: 2026-03-22 | Story: RET-4 | Epic: Epic 14 — Three-Phase Hierarchical Retrieval*
