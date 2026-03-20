# UX-1: Create plugin stylesheet with design tokens and shared styles

**Story**: Deliver the foundational `styles.css` file with CSS custom properties and shared styles that all subsequent UX stories depend on.
**Epic**: Epic 10 — Search and Chat Pane UX Polish
**Size**: Small
**Status**: Open

---

## 1. Summary

UX-1 creates the plugin's first stylesheet (`styles.css` at the project root). Obsidian automatically loads this file when the plugin is enabled — no build pipeline changes or manifest edits are required. The file must exist at the project root alongside `main.js` and `manifest.json`.

This story is the foundation for the entire Epic 10. Every subsequent story (UX-2 through UX-6) depends on the design tokens and shared styles defined here. Without this file, the existing CSS class names used in `SearchView.ts` and `ChatView.ts` have no visual effect beyond Obsidian's defaults.

The key design constraint is theme compatibility: all color values must reference Obsidian's built-in CSS custom properties (`--background-primary`, `--background-secondary`, `--text-normal`, `--text-muted`, `--interactive-accent`, etc.) so the plugin adapts automatically to light mode, dark mode, and custom themes. No hardcoded color values are permitted.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required. This story is purely CSS — no TypeScript type changes are needed.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
styles.css (project root)
├── Design Tokens (CSS custom properties on body)
│   ├── --obsidian-ai-bg-primary      → var(--background-secondary)
│   ├── --obsidian-ai-bg-card         → var(--background-primary)
│   ├── --obsidian-ai-bg-user-bubble  → var(--interactive-accent)
│   ├── --obsidian-ai-bg-assistant-bubble → var(--background-primary)
│   ├── --obsidian-ai-border-radius   → 8px
│   ├── --obsidian-ai-border-radius-lg → 12px
│   ├── --obsidian-ai-spacing-sm      → 6px
│   ├── --obsidian-ai-spacing-md      → 12px
│   └── --obsidian-ai-spacing-lg      → 16px
├── Shared Styles
│   ├── .obsidian-ai-search-view      → padding, text selectability
│   ├── .obsidian-ai-chat-view        → flex column, full height, background
│   ├── Rounded controls              → border-radius on inputs, buttons, textareas
│   └── Text selectability            → user-select: text on result/response elements
├── Search Pane Styles (consumed by UX-2)
│   ├── .obsidian-ai-search-controls  → layout
│   ├── .obsidian-ai-search-controls__query → flex row
│   ├── .obsidian-ai-search-controls__quality → flex row
│   ├── .obsidian-ai-search-result    → card styling
│   ├── .obsidian-ai-search-result__action → link-styled clickable title
│   ├── .obsidian-ai-search-result__path → muted small text
│   ├── .obsidian-ai-search-result__snippet → selectable body text
│   └── .obsidian-ai-search-result__score → pill badge
└── Chat Pane Styles (consumed by UX-3 through UX-6)
    ├── .obsidian-ai-chat-history     → scrollable, flex-grow
    ├── .obsidian-ai-chat-controls    → pinned bottom, flex column
    ├── .obsidian-ai-chat-turn        → turn container
    ├── .obsidian-ai-chat-turn__user  → right-aligned bubble
    ├── .obsidian-ai-chat-turn__assistant → left-aligned bubble, relative position
    ├── .obsidian-ai-chat-turn__copy-btn → positioned top-right of bubble
    ├── .obsidian-ai-chat-turn__sources → flex-wrap row
    ├── .obsidian-ai-chat-turn__source-item → pill button
    ├── .obsidian-ai-chat-input       → multi-line textarea styling
    ├── .obsidian-ai-chat-send        → rounded button
    ├── .obsidian-ai-chat-cancel      → rounded button
    └── .obsidian-ai-chat-new-conversation → rounded button in header
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| N/A — this story is CSS only | N/A | N/A | Styles are consumed by existing and future view classes |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| N/A | CSS applies unconditionally to elements matching the class selectors; no state-dependent logic in the stylesheet |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `styles.css` | Plugin stylesheet with design tokens and all CSS rules for search and chat panes |

### Files to MODIFY

None. No TypeScript, manifest, or build config changes are needed. Obsidian automatically loads `styles.css` from the plugin root directory.

### Files UNCHANGED (confirm no modifications needed)

- `manifest.json` — Obsidian does not require a `styles` field; it auto-discovers `styles.css` by convention.
- `esbuild.config.mjs` — CSS is not bundled through esbuild; Obsidian loads the raw file directly.
- `src/ui/SearchView.ts` — Already uses the class names that will be styled; HTML changes are deferred to UX-2.
- `src/ui/ChatView.ts` — Already uses the class names that will be styled; HTML changes are deferred to UX-3.
- `src/main.ts` — No wiring needed for CSS loading.

---

## 5. Acceptance Criteria Checklist

### Phase A: File Existence and Design Tokens

- [ ] **A1** — `styles.css` exists at the project root
  - The file is present at the same level as `main.js` and `manifest.json`.
  - The file is not empty and contains valid CSS.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::A1_styles_css_exists_at_project_root(vitest)`

- [ ] **A2** — Design tokens are defined as CSS custom properties on `body`
  - The following custom properties are defined: `--obsidian-ai-bg-primary`, `--obsidian-ai-bg-card`, `--obsidian-ai-bg-user-bubble`, `--obsidian-ai-bg-assistant-bubble`, `--obsidian-ai-border-radius`, `--obsidian-ai-border-radius-lg`, `--obsidian-ai-spacing-sm`, `--obsidian-ai-spacing-md`, `--obsidian-ai-spacing-lg`.
  - All color tokens reference Obsidian CSS variables (e.g., `var(--background-primary)`), not hardcoded hex/rgb values.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::A2_design_tokens_reference_obsidian_variables(vitest)`

### Phase B: Search Pane Styles

- [ ] **B1** — Search result cards have visual separation
  - `.obsidian-ai-search-result` has background color, border-radius, padding, and margin-bottom producing visible card separation.
  - Background uses `var(--obsidian-ai-bg-card)`.
  - Border-radius uses `var(--obsidian-ai-border-radius)`.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::B1_search_result_card_styles_defined(vitest)`

- [ ] **B2** — Search result title is styled as a clickable link
  - `.obsidian-ai-search-result__action` has accent color text, no default button chrome (background transparent, no border), and cursor pointer.
  - Hover state adds underline or other visual feedback.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::B2_search_result_action_link_styled(vitest)`

- [ ] **B3** — Search result path is muted and small
  - `.obsidian-ai-search-result__path` uses `var(--text-muted)` color and a reduced font size (e.g., `0.85em`).
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::B3_search_result_path_muted(vitest)`

- [ ] **B4** — Search result snippet text is selectable
  - `.obsidian-ai-search-result__snippet` has `user-select: text` and `cursor: text`.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::B4_search_result_snippet_selectable(vitest)`

- [ ] **B5** — Search result score is displayed as a pill badge
  - `.obsidian-ai-search-result__score` has a subtle background, small border-radius, small font size, and is right-aligned or inline-end positioned.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::B5_search_result_score_pill_badge(vitest)`

- [ ] **B6** — Search controls have rounded corners and flex layout
  - `.obsidian-ai-search-controls__query` uses flex layout with gap.
  - `.obsidian-ai-search-input` and `.obsidian-ai-search-submit` have `border-radius` applied.
  - `.obsidian-ai-search-controls__quality` uses flex layout with gap and vertical centering.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::B6_search_controls_rounded_flex(vitest)`

### Phase C: Chat Pane Styles

- [ ] **C1** — Chat view uses flex column layout with full height
  - `.obsidian-ai-chat-view` has `display: flex`, `flex-direction: column`, and `height: 100%`.
  - Background uses `var(--obsidian-ai-bg-primary)` to contrast with bubble colors.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C1_chat_view_flex_column(vitest)`

- [ ] **C2** — Chat history area is scrollable and fills available space
  - `.obsidian-ai-chat-history` has `flex: 1`, `overflow-y: auto`, and padding.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C2_chat_history_scrollable(vitest)`

- [ ] **C3** — User message bubbles are right-aligned
  - `.obsidian-ai-chat-turn__user` has `margin-left: auto`, `max-width` constraint (e.g., 85%), rounded corners, padding, and background using `var(--obsidian-ai-bg-user-bubble)`.
  - Text color contrasts with the accent background.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C3_user_bubble_right_aligned(vitest)`

- [ ] **C4** — Assistant message bubbles are left-aligned with selectable text
  - `.obsidian-ai-chat-turn__assistant` has `margin-right: auto`, `max-width` constraint, rounded corners, padding, background using `var(--obsidian-ai-bg-assistant-bubble)`, and `position: relative` (for copy button positioning).
  - `user-select: text` is set to ensure selectability.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C4_assistant_bubble_left_aligned_selectable(vitest)`

- [ ] **C5** — Copy button is positioned in the upper-right corner of assistant bubbles
  - `.obsidian-ai-chat-turn__copy-btn` has `position: absolute`, `top` and `right` offsets, small size, and cursor pointer.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C5_copy_button_positioned(vitest)`

- [ ] **C6** — Source items are styled as pill buttons
  - `.obsidian-ai-chat-turn__sources` uses `display: flex`, `flex-wrap: wrap`, and `gap`.
  - `.obsidian-ai-chat-turn__source-item` has pill border-radius, padding, background, accent color text, and cursor pointer.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C6_source_pill_buttons(vitest)`

- [ ] **C7** — Chat controls are pinned to the bottom with rounded elements
  - `.obsidian-ai-chat-controls` has padding and border-top for visual separation from the history area.
  - `.obsidian-ai-chat-input` (textarea) has `width: 100%`, `border-radius`, and `resize: vertical`.
  - `.obsidian-ai-chat-send` and `.obsidian-ai-chat-cancel` have `border-radius`.
  - `.obsidian-ai-chat-new-conversation` has `border-radius`.
  - Evidence: `src/__tests__/unit/stylesExistence.test.ts::C7_chat_controls_pinned_rounded(vitest)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [ ] **Z3** — No `any` types in any new or modified file
  - Not applicable — this story creates only a CSS file and tests.
  - Evidence: `styles.css::Z3_no_any_types(n/a — CSS only)`
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable — no new TypeScript imports are introduced.
  - Evidence: `styles.css::Z4_import_path_consistency(n/a — CSS only)`
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Not applicable — CSS files do not include logging.
  - Evidence: `styles.css::Z5_logging(n/a — CSS only)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Obsidian CSS variable names may change across versions | Use only well-established variables documented in the Obsidian developer docs (`--background-primary`, `--text-normal`, etc.); these have been stable since Obsidian 1.0 |
| 2 | Custom themes may override Obsidian's base variables with unexpected values | Design tokens add a single indirection layer; if a theme produces poor contrast, users can override the `--obsidian-ai-*` tokens in a CSS snippet |
| 3 | Defining styles for classes not yet used in HTML (e.g., `__copy-btn`, `__source-item` as pills) means styles exist before the elements do | This is intentional — UX-2 through UX-6 will add the HTML elements that consume these styles; having CSS ready first avoids merge conflicts and enables parallel story work |
| 4 | CSS validation tests read the file as text rather than rendering in a browser | Tests verify structural properties (selectors present, tokens reference `var(--...)`) rather than visual rendering; visual verification is done manually in Obsidian |

---

## Implementation Order

1. `styles.css` — Create the file at project root with the following sections in order:
   - Design tokens block (`body { ... }`)
   - Shared control styles (rounded inputs, buttons)
   - Search pane view and controls layout
   - Search result card styles (card, action, path, snippet, score)
   - Chat pane view layout (flex column, full height)
   - Chat history and controls layout
   - Chat bubble styles (user right-aligned, assistant left-aligned)
   - Chat copy button positioning
   - Chat source pill buttons
   - Chat input area (textarea, send/cancel, new conversation)
   - (covers A1, A2, B1–B6, C1–C7)
2. `src/__tests__/unit/stylesExistence.test.ts` — Create test file that reads `styles.css` as text and verifies:
   - File exists and is non-empty (A1)
   - Design tokens are present and reference Obsidian variables (A2)
   - Key selectors are present for search cards (B1–B6)
   - Key selectors are present for chat layout (C1–C7)
3. **Verify** — Run `npm run test` to confirm all style existence tests pass.
4. **Final verify** — Run `npm run build && npm run lint && npm run test` to confirm no regressions.

---

*Created: 2026-03-20 | Story: UX-1 | Epic: Epic 10 — Search and Chat Pane UX Polish*
