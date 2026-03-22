# HIER-4: Implement token estimator utility

**Story**: Implement a token estimation utility that approximates token counts for text content, used by the context assembly service to enforce per-tier token budgets during retrieval.
**Epic**: Epic 11 — Hierarchical Document Model and Tree Chunker
**Size**: Small
**Status**: Open

---

## 1. Summary

This story delivers the token estimation utility required by the context assembly service (RET-3) and the summary service (SUM-1) for enforcing token budgets. The retrieval pipeline's Phase 3 (Context Assembly) applies separate token budgets per tier: matched content (~2000 tokens), sibling context (~1000 tokens), and parent summaries (~1000 tokens). These budgets require a fast, synchronous token counting mechanism.

The primary approach uses a character-based heuristic (`chars / 4`) which is a well-established approximation for English text with GPT-family tokenizers. The utility also exposes an optional integration point for tiktoken-based exact counting, but the MVP implementation uses only the heuristic to avoid adding a heavy dependency.

The estimator is a pure utility with no dependencies on other HIER stories, Obsidian APIs, or external services. It is consumed by RET-3 (ContextAssemblyService), SUM-1 (SummaryService for checking leaf node token counts against the ~200 token threshold), and HIER-5 (the tree chunker, for optional token estimates on nodes).

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The token estimator exports a small API surface:

```ts
export function estimateTokens(text: string): number;

export function fitsWithinBudget(text: string, budget: number): boolean;

export function truncateToTokenBudget(text: string, budget: number): string;
```

These are pure functions defined in `src/utils/tokenEstimator.ts`. No new types need to be added to `src/types.ts`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
RET-3: ContextAssemblyService (future caller)
├── estimateTokens(matchedContent)
├── fitsWithinBudget(siblingContent, siblingBudget)
└── truncateToTokenBudget(parentSummary, parentBudget)

SUM-1: SummaryService (future caller)
└── estimateTokens(leafContent) → skip LLM if below ~200 tokens

HIER-5: HierarchicalChunker (future caller)
└── estimateTokens(nodeContent) → optional tokenEstimate on DocumentNode
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `estimateTokens` | `(text: string) => number` | Stateless/pure | Returns approximate token count using `ceil(chars / 4)` heuristic |
| `fitsWithinBudget` | `(text: string, budget: number) => boolean` | Stateless/pure | Convenience check: `estimateTokens(text) <= budget` |
| `truncateToTokenBudget` | `(text: string, budget: number) => string` | Stateless/pure | Truncates text at word boundary to fit within token budget |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — pure synchronous functions |
| Error   | Not applicable — functions handle all inputs gracefully |
| Empty   | Empty string returns `0` tokens, `true` for any positive budget, empty string for truncation |
| Success | Returns token estimate, boolean, or truncated string |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/utils/tokenEstimator.ts` | Token estimation utility with heuristic-based counting |
| 2 | `src/__tests__/unit/tokenEstimator.test.ts` | Unit tests for estimation accuracy, budget checking, and truncation |

### Files to MODIFY

None. This is a standalone utility with no modifications to existing files.

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — no new shared types needed
- `src/utils/chunker.ts` — existing flat chunker untouched
- `src/settings.ts` — token budget settings are added in INTG-4
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/bootstrap/bootstrapRuntimeServices.ts` — no service wiring needed for a utility function

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Token Estimation

- [ ] **A1** — `estimateTokens` returns approximate token count using chars/4 heuristic
  - For a 400-character string, the estimate should be `100`.
  - The function uses `Math.ceil(text.length / 4)` as the base formula.
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::A1_chars_divided_by_four(vitest)`

- [ ] **A2** — `estimateTokens` handles empty and whitespace-only input
  - `estimateTokens("")` returns `0`.
  - `estimateTokens("   ")` returns a small positive number (whitespace is counted).
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::A2_empty_and_whitespace_input(vitest)`

- [ ] **A3** — `estimateTokens` is reasonably accurate for typical English text
  - For a representative paragraph of ~100 words, the estimate should be within 20% of the actual GPT-4 token count (typically ~130-150 tokens for 100 words).
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::A3_reasonable_accuracy_english_text(vitest)`

### Phase B: Budget Checking

- [ ] **B1** — `fitsWithinBudget` returns `true` when text fits
  - A 200-character string fits within a budget of `100` tokens (200/4 = 50 <= 100).
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::B1_fits_within_budget_true(vitest)`

- [ ] **B2** — `fitsWithinBudget` returns `false` when text exceeds budget
  - A 1000-character string does not fit within a budget of `100` tokens (1000/4 = 250 > 100).
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::B2_exceeds_budget_false(vitest)`

- [ ] **B3** — `fitsWithinBudget` handles edge cases
  - Empty string fits within any positive budget. Zero budget returns `true` for empty string and `false` for non-empty.
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::B3_budget_edge_cases(vitest)`

### Phase C: Token-Budget Truncation

- [ ] **C1** — `truncateToTokenBudget` truncates at word boundary
  - A long string truncated to a small budget is cut at the last word boundary that fits within the budget.
  - The result does not end with a partial word.
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::C1_truncates_at_word_boundary(vitest)`

- [ ] **C2** — `truncateToTokenBudget` returns full text when it fits
  - If the text already fits within the budget, it is returned unchanged.
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::C2_returns_full_text_when_fits(vitest)`

- [ ] **C3** — `truncateToTokenBudget` adds ellipsis indicator when truncated
  - When truncation occurs, the result ends with `...` to indicate content was cut.
  - The `...` is included within the token budget (not added on top of it).
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::C3_ellipsis_on_truncation(vitest)`

- [ ] **C4** — `truncateToTokenBudget` handles empty input
  - `truncateToTokenBudget("", 100)` returns `""`.
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::C4_empty_input_truncation(vitest)`

### Phase D: Determinism and Purity

- [ ] **D1** — All functions are deterministic
  - Given identical input, repeated calls produce identical output for all three functions.
  - Evidence: `src/__tests__/unit/tokenEstimator.test.ts::D1_deterministic_output(vitest)`

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
| 1 | The chars/4 heuristic is an approximation that varies by language and content type | For English text with GPT-family tokenizers, chars/4 is within ~10-20% accuracy; this is sufficient for budget enforcement where exact counts are not critical |
| 2 | No tiktoken integration in MVP means estimates may diverge for non-English or code-heavy content | The utility exposes a clean API that can be swapped to tiktoken-based counting without changing callers; document this as a future enhancement |
| 3 | Truncation at word boundaries may leave slightly less content than the budget allows | This is conservative by design — slightly under-budget is preferable to over-budget for LLM context windows |
| 4 | The `...` ellipsis on truncation consumes ~1 token of the budget | This is negligible relative to typical budgets (1000-2000 tokens) and provides important UX signal that content was truncated |

---

## Implementation Order

1. `src/utils/tokenEstimator.ts` — Implement `estimateTokens`, `fitsWithinBudget`, and `truncateToTokenBudget` functions (covers A1–A3, B1–B3, C1–C4, D1)
2. **Verify** — `npm run typecheck` to confirm the new file compiles
3. `src/__tests__/unit/tokenEstimator.test.ts` — Write unit tests for all acceptance criteria (covers A1–D1)
4. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: HIER-4 | Epic: Epic 11 — Hierarchical Document Model and Tree Chunker*
