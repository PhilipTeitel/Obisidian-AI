# UX-3: Redesign Chat pane layout with bubble alignment and bottom input area

**Story**: Restructure the ChatView HTML so the CSS classes from UX-1's `styles.css` produce the intended chat layout: right-aligned user bubbles, left-aligned assistant bubbles, multi-line textarea at bottom, scrollable history area, and auto-scroll to newest message.
**Epic**: Epic 10 — Search and Chat Pane UX Polish
**Size**: Medium
**Status**: Done

---

## 1. Summary

UX-3 restructures the `ChatView.onOpen()` and `renderState()` methods to produce a DOM layout that matches the CSS rules defined in UX-1. The current implementation renders the chat input area at the top (before history), uses `<input>` instead of `<textarea>`, and prefixes bubble text with "You:" / "Assistant:" labels rather than relying on visual alignment to distinguish speakers.

This story reorders the DOM so the header comes first, then the scrollable history area, then the controls pinned at the bottom. The input changes from `<input>` to `<textarea>` for multi-line support. User and assistant messages render as visually distinct bubbles without text prefixes. The history container auto-scrolls to the bottom after each state update so the newest message is always visible.

This story modifies only `ChatView.ts` and its test file. The `ChatPaneModel` is unchanged. The CSS is already in place from UX-1.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required. This story only modifies the view layer's HTML rendering.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatView.onOpen()
└── div.obsidian-ai-chat-view
    ├── div.obsidian-ai-chat-header
    │   └── h2 "Vault Chat"
    ├── p.obsidian-ai-chat-status
    ├── div.obsidian-ai-chat-history              (scrollable, flex-grow)
    │   └── For each ChatTurn:
    │       └── div.obsidian-ai-chat-turn
    │           ├── div.obsidian-ai-chat-turn__user     (right-aligned bubble)
    │           ├── div.obsidian-ai-chat-turn__assistant (left-aligned bubble)
    │           ├── p.obsidian-ai-chat-turn__status      (muted status text)
    │           ├── p.obsidian-ai-chat-turn__error       (if error)
    │           └── div.obsidian-ai-chat-turn__sources   (if sources)
    │               └── span.obsidian-ai-chat-turn__source-item × N
    └── div.obsidian-ai-chat-controls             (pinned bottom)
        ├── textarea.obsidian-ai-chat-input       (multi-line)
        └── div.obsidian-ai-chat-button-row
            ├── button.obsidian-ai-chat-send
            └── button.obsidian-ai-chat-cancel
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatView.onOpen` | N/A | N/A | DOM structure changes; controls move below history |
| `ChatView.renderState` | `(state: ChatPaneState) => void` | Uses `state.turns`, `state.draft`, `state.canSend`, `state.canCancel`, `state.status` | Bubbles use `<div>` instead of `<p>`, no text prefixes; auto-scroll after render |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Idle (no turns) | Status text shows "Ask a question to start chat." History area is empty. |
| Streaming | Status text shows "Generating response..." Assistant bubble shows partial text with "(waiting...)" fallback. |
| Error | Status text shows error message. Turn shows error text. |
| Complete | Status text shows "Chat ready." All turns rendered with final text. |

---

## 4. File Touchpoints

### Files to CREATE

None.

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/ChatView.ts` | Reorder DOM: header → status → history → controls; change `<input>` to `<textarea>`; change bubbles from `<p>` to `<div>` without text prefixes; add auto-scroll; wrap buttons in `.obsidian-ai-chat-button-row` |
| 2 | `src/__tests__/unit/chatView.test.ts` | Update tests for new DOM structure: textarea, div bubbles, no text prefixes, button row, header |

### Files UNCHANGED (confirm no modifications needed)

- `styles.css` — All CSS rules are already in place from UX-1.
- `src/ui/ChatPaneModel.ts` — No model changes needed.
- `src/types.ts` — No type changes needed.
- `src/main.ts` — No wiring changes needed.
- `src/constants.ts` — No constant changes needed.

---

## 5. Acceptance Criteria Checklist

### Phase A: DOM Structure

- [x] **A1** — Chat controls are rendered below the history area (bottom-pinned layout)
  - The `.obsidian-ai-chat-controls` element appears after `.obsidian-ai-chat-history` in the DOM.
  - The `.obsidian-ai-chat-header` element appears before `.obsidian-ai-chat-history`.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A1_controls_below_history(vitest)`

- [x] **A2** — Chat input is a `<textarea>` for multi-line support
  - The element with class `obsidian-ai-chat-input` is a `<textarea>` (tag name `TEXTAREA`), not an `<input>`.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A2_input_is_textarea(vitest)`

- [x] **A3** — User message renders as a `<div>` bubble without "You:" prefix
  - The element with class `obsidian-ai-chat-turn__user` is a `<div>` (tag name `DIV`).
  - The text content is the raw user message without any "You:" prefix.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A3_user_bubble_no_prefix(vitest)`

- [x] **A4** — Assistant message renders as a `<div>` bubble without "Assistant:" prefix
  - The element with class `obsidian-ai-chat-turn__assistant` is a `<div>` (tag name `DIV`).
  - The text content is the raw assistant message without any "Assistant:" prefix.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A4_assistant_bubble_no_prefix(vitest)`

- [x] **A5** — Send and Cancel buttons are wrapped in a `.obsidian-ai-chat-button-row` div
  - Both `.obsidian-ai-chat-send` and `.obsidian-ai-chat-cancel` are children of a `.obsidian-ai-chat-button-row` element.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A5_buttons_in_button_row(vitest)`

### Phase B: Auto-scroll and Behavior

- [x] **B1** — History area auto-scrolls to bottom after state update
  - After rendering turns, `historyEl.scrollTop` is set to `historyEl.scrollHeight`.
  - Evidence: `src/__tests__/unit/chatView.test.ts::B1_auto_scroll_after_render(vitest)`

### Phase C: Backward Compatibility

- [x] **C1** — Existing chat view functionality is preserved
  - Controls (input, send, cancel, status, history) are all present.
  - Sources still render with `.obsidian-ai-chat-turn__source-item` elements.
  - Evidence: `src/__tests__/unit/chatView.test.ts::C1_renders_chat_controls(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/ChatView.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable — no new imports introduced.
  - Evidence: `src/ui/ChatView.ts::Z4_import_path_consistency(n/a)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Not applicable — view rendering does not require logging; model already logs.
  - Evidence: `src/ui/ChatView.ts::Z5_logging(n/a — view layer)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Changing `<input>` to `<textarea>` changes the Enter key behavior (Enter inserts newline instead of submitting) | Users click the Send button; a future story can add Shift+Enter or Ctrl+Enter to submit |
| 2 | Removing "You:" / "Assistant:" text prefixes relies on visual bubble alignment to distinguish speakers | CSS from UX-1 provides clear visual distinction (right-aligned accent-colored user bubbles vs left-aligned neutral assistant bubbles) |
| 3 | Auto-scroll may override user's manual scroll position | This is standard chat UX; a future story can add "scroll to bottom" button when user scrolls up |

---

## Implementation Order

1. `src/ui/ChatView.ts` — Restructure `onOpen()`:
   - Create header div with h2
   - Create status element
   - Create history div
   - Create controls div with textarea, button row (send + cancel)
   - Update `renderState()`: use `<div>` for bubbles, remove text prefixes, add auto-scroll
   - (covers A1, A2, A3, A4, A5, B1)
2. `src/__tests__/unit/chatView.test.ts` — Update and add tests:
   - Update `C1_renders_chat_controls` for new structure
   - Update `C2_renders_history_and_sources` for div bubbles and no prefixes
   - Add `A1_controls_below_history`
   - Add `A2_input_is_textarea`
   - Add `A3_user_bubble_no_prefix`
   - Add `A4_assistant_bubble_no_prefix`
   - Add `A5_buttons_in_button_row`
   - Add `B1_auto_scroll_after_render`
   - (covers A1–A5, B1, C1)
3. **Verify** — Run `npx vitest run src/__tests__/unit/chatView.test.ts`
4. **Final verify** — Run `npm run build && npm run lint && npm run test`

---

*Created: 2026-03-20 | Story: UX-3 | Epic: Epic 10 — Search and Chat Pane UX Polish*
