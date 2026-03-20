# UX-4: Add copy-to-clipboard button on assistant response bubbles

**Story**: Add a copy icon button in the upper-right corner of each assistant bubble that copies the full response text to the clipboard via `navigator.clipboard.writeText`.
**Epic**: Epic 10 — Search and Chat Pane UX Polish
**Size**: Small
**Status**: Done

---

## 1. Summary

UX-4 adds a small copy button inside each assistant message bubble. The button is positioned in the upper-right corner using `position: absolute` (the assistant bubble already has `position: relative` from UX-1's CSS). Clicking the button copies the assistant's response text to the system clipboard.

The CSS for `.obsidian-ai-chat-turn__copy-btn` is already defined in UX-1's `styles.css`. This story only adds the HTML element and the click handler in `ChatView.renderState()`.

This story depends on UX-3 (which changed bubbles to `<div>` elements). It is independent of UX-5 and UX-6.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required. This story only modifies the view layer.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatView.renderState()
└── For each ChatTurn:
    └── div.obsidian-ai-chat-turn
        ├── div.obsidian-ai-chat-turn__user
        ├── div.obsidian-ai-chat-turn__assistant  (position: relative)
        │   └── button.obsidian-ai-chat-turn__copy-btn  (NEW — position: absolute, top-right)
        ├── p.obsidian-ai-chat-turn__status
        └── ...
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatView.renderState` | `(state: ChatPaneState) => void` | Uses `turn.assistantMessage` | Adds copy button inside assistant bubble div |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Streaming (partial text) | Copy button is present; copies whatever partial text is available |
| Complete | Copy button copies full response text |
| Waiting (no text yet) | Copy button copies "(waiting...)" fallback text |

---

## 4. File Touchpoints

### Files to CREATE

None.

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/ChatView.ts` | Add copy button inside assistant bubble div in `renderState()` |
| 2 | `src/__tests__/unit/chatView.test.ts` | Add tests for copy button presence and clipboard interaction |

### Files UNCHANGED (confirm no modifications needed)

- `styles.css` — Copy button CSS already defined in UX-1.
- `src/ui/ChatPaneModel.ts` — No model changes needed.
- `src/types.ts` — No type changes needed.
- `src/main.ts` — No wiring changes needed.

---

## 5. Acceptance Criteria Checklist

### Phase A: Copy Button

- [x] **A1** — Each assistant bubble contains a copy button
  - The element with class `obsidian-ai-chat-turn__copy-btn` is a `<button>` inside the `.obsidian-ai-chat-turn__assistant` div.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A1_copy_button_in_assistant_bubble(vitest)`

- [x] **A2** — Copy button copies assistant message text to clipboard
  - Clicking the copy button calls `navigator.clipboard.writeText` with the assistant message text.
  - Evidence: `src/__tests__/unit/chatView.test.ts::A2_copy_button_writes_to_clipboard(vitest)`

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
  - Not applicable — view rendering does not require logging.
  - Evidence: `src/ui/ChatView.ts::Z5_logging(n/a — view layer)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | `navigator.clipboard.writeText` may not be available in all Electron versions | Obsidian runs on modern Electron; clipboard API is well-supported. A try/catch wraps the call. |
| 2 | Copy button is always visible (no hover-to-reveal) | CSS from UX-1 sets `opacity: 0.5` with `opacity: 1` on hover, providing subtle presence |

---

## Implementation Order

1. `src/ui/ChatView.ts` — In `renderState()`, after creating the assistant bubble div, create a `<button>` child with class `obsidian-ai-chat-turn__copy-btn` and text "📋". Bind click to copy `turn.assistantMessage` to clipboard.
   - (covers A1, A2)
2. `src/__tests__/unit/chatView.test.ts` — Add tests:
   - `A1_copy_button_in_assistant_bubble`
   - `A2_copy_button_writes_to_clipboard`
3. **Verify** — Run `npx vitest run src/__tests__/unit/chatView.test.ts`
4. **Final verify** — Run `npm run build && npm run lint && npm run test`

---

*Created: 2026-03-20 | Story: UX-4 | Epic: Epic 10 — Search and Chat Pane UX Polish*
