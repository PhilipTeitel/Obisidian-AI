# UX-2: Redesign Semantic Search result cards with visual hierarchy and text selectability

**Story**: Update the search result rendering in `SearchView` so each result is a visually distinct card with a clickable title link, muted path, selectable snippet, and score pill badge.
**Epic**: Epic 10 — Search and Chat Pane UX Polish
**Size**: Medium
**Status**: Done

---

## 1. Summary

UX-2 changes the HTML structure of search results in `SearchView.ts` so the CSS classes defined in UX-1's `styles.css` produce the intended visual hierarchy. The current implementation renders the note title as a `<button>`, which suppresses text selection and looks like a generic button rather than a clickable link. The path, snippet, and score are plain `<p>` elements with no visual distinction.

This story modifies only the `renderState` method in `SearchView.ts` to produce an improved DOM structure. The CSS is already in place from UX-1. The result card layout becomes: clickable title (styled as a link via `<span>` with click handler), muted file path, selectable snippet text, and a score pill badge with a clearfix wrapper.

This is the only search-pane story in Epic 10. The chat pane stories (UX-3 through UX-6) are independent of this work.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required. The `SearchResult` interface in `src/types.ts` is unchanged. This story only modifies the view layer's HTML rendering.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
SearchView.renderState()
└── For each SearchResult:
    └── div.obsidian-ai-search-result          (card container)
        ├── span.obsidian-ai-search-result__action  (clickable title, styled as link)
        ├── p.obsidian-ai-search-result__path       (muted file path)
        ├── p.obsidian-ai-search-result__snippet    (selectable text)
        └── div (clearfix wrapper)
            └── span.obsidian-ai-search-result__score (pill badge, float right)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SearchView.renderState` | `(state: SearchPaneState) => void` | Uses `state.results` | Only the result loop body changes; control rendering is unchanged |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Unchanged — status text shows "Searching semantic index..." |
| Error | Unchanged — status text shows error message |
| Empty | Unchanged — status text shows no-results message |
| Success | Result cards rendered with new HTML structure; all text selectable |

---

## 4. File Touchpoints

### Files to CREATE

None.

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/SearchView.ts` | Change result rendering: replace `<button>` title with `<span>` click handler; change score from `<p>` to `<span>` inside a clearfix `<div>`; keep all existing class names |
| 2 | `src/__tests__/unit/searchView.test.ts` | Update selectors from `button` to `span` for the action element; add test for score element type |

### Files UNCHANGED (confirm no modifications needed)

- `styles.css` — All CSS rules are already in place from UX-1.
- `src/ui/SearchPaneModel.ts` — No model changes needed.
- `src/types.ts` — `SearchResult` interface is unchanged.
- `src/main.ts` — No wiring changes needed.

---

## 5. Acceptance Criteria Checklist

### Phase A: Result Card HTML Structure

- [x] **A1** — Note title renders as a `<span>` with click handler instead of `<button>`
  - The element with class `obsidian-ai-search-result__action` is a `<span>` (tag name `SPAN`), not a `<button>`.
  - Clicking the element still calls `model.openResult(result)`.
  - The title text includes `noteTitle` and optional `heading` separated by " — ".
  - Evidence: `src/__tests__/unit/searchView.test.ts::A1_title_renders_as_span_with_click(vitest)`

- [x] **A2** — File path renders with muted styling class
  - The element with class `obsidian-ai-search-result__path` is present and contains the `notePath` value.
  - Evidence: `src/__tests__/unit/searchView.test.ts::A3_renders_result_metadata(vitest)`

- [x] **A3** — Snippet text is present and selectable
  - The element with class `obsidian-ai-search-result__snippet` is present and contains the snippet text.
  - The CSS class (from UX-1) applies `user-select: text` — verified structurally by class presence.
  - Evidence: `src/__tests__/unit/searchView.test.ts::A3_renders_result_metadata(vitest)`

- [x] **A4** — Score renders as a `<span>` pill badge inside a clearfix wrapper
  - The element with class `obsidian-ai-search-result__score` is a `<span>` (tag name `SPAN`).
  - The score text contains the formatted numeric value (e.g., "0.923").
  - Evidence: `src/__tests__/unit/searchView.test.ts::A4_score_renders_as_span_pill(vitest)`

### Phase B: Backward Compatibility

- [x] **B1** — Existing search view tests pass with updated selectors
  - The `A1_renders_search_input_and_actions` test still passes (controls unchanged).
  - The `A3_renders_result_metadata` test passes with updated element expectations.
  - Evidence: `src/__tests__/unit/searchView.test.ts::A1_renders_search_input_and_actions(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/SearchView.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable — no new imports introduced.
  - Evidence: `src/ui/SearchView.ts::Z4_import_path_consistency(n/a)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Not applicable — view rendering does not require logging; model already logs.
  - Evidence: `src/ui/SearchView.ts::Z5_logging(n/a — view layer)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Changing `<button>` to `<span>` removes native keyboard accessibility (Enter/Space to activate) | The `<span>` retains `cursor: pointer` via CSS and click handler; keyboard navigation can be added in a future accessibility story if needed |
| 2 | Existing tests reference `<button>` element — tests must be updated simultaneously | Tests are updated in the same story to avoid a broken intermediate state |
| 3 | The title separator changes from " - " to " — " (em dash) for visual polish | Minor cosmetic change; no functional impact |

---

## Implementation Order

1. `src/ui/SearchView.ts` — Update the result rendering loop in `renderState`:
   - Change title from `createEl("button", ...)` to `createEl("span", ...)` with the same click handler
   - Change title separator from ` - ` to ` — `
   - Change score from `createEl("p", ...)` to a wrapper `createDiv()` containing `createEl("span", ...)`
   - (covers A1, A2, A3, A4)
2. `src/__tests__/unit/searchView.test.ts` — Update existing tests and add new ones:
   - Update `A3_renders_result_metadata` to match new element types
   - Add `A1_title_renders_as_span_with_click` test
   - Add `A4_score_renders_as_span_pill` test
   - (covers A1, A4, B1)
3. **Verify** — Run `npx vitest run src/__tests__/unit/searchView.test.ts`
4. **Final verify** — Run `npm run build && npm run lint && npm run test`

---

*Created: 2026-03-20 | Story: UX-2 | Epic: Epic 10 — Search and Chat Pane UX Polish*
