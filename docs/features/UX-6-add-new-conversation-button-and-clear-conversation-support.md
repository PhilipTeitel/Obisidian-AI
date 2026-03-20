# UX-6: Add New Conversation button and clear conversation support

**Story**: Add `clearConversation()` to ChatPaneModel and render a "New Conversation" button in the chat header that resets turns and status.
**Epic**: Epic 10 — Search and Chat Pane UX Polish
**Size**: Small
**Status**: Done

---

## 1. Summary

UX-6 adds the ability to start a fresh conversation without closing and reopening the chat pane. A `clearConversation()` method is added to `ChatPaneModel` that resets the turns array, draft, status, and error state to their initial values. A "New Conversation" button is rendered in the chat header (next to the "Vault Chat" title) that calls this method.

The CSS for `.obsidian-ai-chat-new-conversation` (rounded button styling) and `.obsidian-ai-chat-header` (flex layout with space-between) is already defined in UX-1's `styles.css`.

This story depends on UX-3 (which introduced the header div). It is independent of UX-4 and UX-5.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatView.onOpen()
└── div.obsidian-ai-chat-view
    ├── div.obsidian-ai-chat-header
    │   ├── h2 "Vault Chat"
    │   └── button.obsidian-ai-chat-new-conversation "New Conversation"
    ├── p.obsidian-ai-chat-status
    ├── div.obsidian-ai-chat-history
    └── div.obsidian-ai-chat-controls
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatPaneModel.clearConversation` | `() => void` | Resets `turns`, `draft`, `status`, `errorMessage`, `canSend`, `canCancel` | New public method |
| `ChatView.onOpen` | N/A | N/A | Adds "New Conversation" button in header |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| After clear | Turns array is empty, draft is empty, status is "idle", canSend is true, canCancel is false |
| During streaming | Clear is blocked (canSend is false during streaming, but clearConversation resets regardless) |

---

## 4. File Touchpoints

### Files to CREATE

None.

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/ChatPaneModel.ts` | Add `clearConversation()` public method |
| 2 | `src/ui/ChatView.ts` | Add "New Conversation" button in header div |
| 3 | `src/__tests__/unit/chatPaneModel.test.ts` | Add test for `clearConversation` |
| 4 | `src/__tests__/unit/chatView.test.ts` | Add test for "New Conversation" button presence |

### Files UNCHANGED (confirm no modifications needed)

- `styles.css` — Button CSS already defined in UX-1.
- `src/types.ts` — No type changes needed.
- `src/main.ts` — No wiring changes needed.

---

## 5. Acceptance Criteria Checklist

### Phase A: Model

- [x] **A1** — `ChatPaneModel` exposes a `clearConversation()` method that resets state
  - After calling `clearConversation()`, `getState()` returns: turns=[], draft="", status="idle", canSend=true, canCancel=false, errorMessage=undefined.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::A1_clearConversation_resets_state(vitest)`

### Phase B: View

- [x] **B1** — "New Conversation" button is rendered in the chat header
  - The element with class `obsidian-ai-chat-new-conversation` is a `<button>` inside `.obsidian-ai-chat-header`.
  - The button text is "New Conversation".
  - Evidence: `src/__tests__/unit/chatView.test.ts::B1_new_conversation_button_in_header(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/ChatPaneModel.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable — no new imports.
  - Evidence: `src/ui/ChatPaneModel.ts::Z4_import_path_consistency(n/a)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - `clearConversation` logs an info event.
  - Evidence: `src/ui/ChatPaneModel.ts::Z5_logging(code review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Clearing during an active stream could leave the iterator in a dangling state | `clearConversation` also cancels any active stream before resetting |
| 2 | No confirmation dialog before clearing | Standard chat UX; users expect immediate action from a "New Conversation" button |

---

## Implementation Order

1. `src/ui/ChatPaneModel.ts` — Add `clearConversation()` method that cancels active stream (if any), resets state to initial values, and logs.
   - (covers A1)
2. `src/ui/ChatView.ts` — In `onOpen()`, add a "New Conversation" button in the header div with click handler calling `model.clearConversation()`.
   - (covers B1)
3. `src/__tests__/unit/chatPaneModel.test.ts` — Add `A1_clearConversation_resets_state` test.
4. `src/__tests__/unit/chatView.test.ts` — Add `B1_new_conversation_button_in_header` test.
5. **Verify** — Run `npx vitest run src/__tests__/unit/chatView.test.ts src/__tests__/unit/chatPaneModel.test.ts`
6. **Final verify** — Run `npm run build && npm run lint && npm run test`

---

*Created: 2026-03-20 | Story: UX-6 | Epic: Epic 10 — Search and Chat Pane UX Polish*
