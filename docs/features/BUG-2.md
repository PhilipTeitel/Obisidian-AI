# BUG-2: Selectable text for user and assistant chat messages

**Story**: Make every chat message in the ChatView — both user and assistant bubbles — selectable with pointer and keyboard so normal copy/paste works. Fixes BUG-001 / [REQ-006 S3](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md).
**Epic**: 11 — Chat accuracy and UX bug fixes (REQ-006)
**Size**: Small
**Status**: Open

---

## 1. Summary

Users report in [BUG-001](../requests/BUG-001.md) that neither user nor assistant message text can be selected for copying in the chat pane. This makes quoting the assistant's answer elsewhere or recovering a long prompt after a failed send impossible without manual retyping. [REQ-006 S3](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) sets the acceptance: both message roles must be selectable with pointer and keyboard, and the selected text must be copyable via the OS clipboard shortcut.

The root cause is that [`ChatView.renderMessages`](../../src/plugin/ui/ChatView.ts) renders message content inside container elements that inherit `user-select: none` from ancestor styles or widget components introduced for the chips/streaming rendering. Obsidian's default theme allows selection inside content views, so the fix is to explicitly opt message-body elements into selection via CSS (`user-select: text`, `-webkit-user-select: text`) and ensure no non-text child element (e.g. role label, spinner) steals pointer events.

This story is intentionally **UI-only**: no workflow, retrieval, or API changes. The only visible difference is that the user and assistant message bodies become selectable.

**Out-of-scope `Sn` from REQ-006:** S1, S2, S4, S5, S6, S7 (owned by BUG-1, BUG-3, BUG-4).

**Prerequisites:** [UI-3](UI-3.md) / [CHAT-1](CHAT-1.md) (chat pane exists). **Linked REQ:** [REQ-006](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md).

---

## 2. Linked architecture decisions (ADRs)

**None — this story inherits only epic-level ADRs already linked from the README.** Pure UI change with no binding integration boundary. ([ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) governs chat behavior but is not affected by rendering changes.)

---

## 3. Definition of Ready (DoR)

- [ ] No binding ADR is required (text selection is not an integration boundary). This is explicitly declared in Section 2.
- [ ] README §UI Components ChatView says "All message text — both user and assistant — is selectable" (updated with REQ-006 design-section patch).
- [ ] Section 4 lists the two styling constraints (user + assistant text selectable, no ancestor blocks it).
- [ ] Section 4b is marked **not applicable** with a one-sentence reason.
- [ ] Section 8a Test Plan covers both UI states with DOM-level assertions; REQ-006 S3 maps to at least one row.
- [ ] Phase Y contains at least one `(binding)` criterion asserting the computed style or equivalent DOM observable — not just a code grep — so QA can verify in a real Obsidian runtime.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — User message bodies have CSS such that `getComputedStyle(el).userSelect === 'text'` (or `'auto'` resolving to text on the platform).
2. **Y2** — Assistant message bodies satisfy the same condition as Y1.
3. **Y3** — No ancestor container of a message body imposes `user-select: none` that would override the message-level rule.
4. **Y4** — Source chips and role labels remain non-selectable (they are UI chrome) — selecting a message body does not accidentally extend into them.
5. **Y5** — Rendering of streaming deltas (mid-reply updates) must not wipe the user's current selection in an already-complete assistant bubble.

---

## 4b. Ports & Adapters

**Not applicable — this story does not introduce or modify any port or adapter.** It is a CSS / DOM rendering change in `src/plugin/ui/ChatView.ts` and `styles.css`.

---

## 5. API Endpoints + Schemas

No API changes. No types change. The `chat` wire protocol, sidecar runtime, and all workflows are unaffected.

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

```
ChatView
└── .obsidian-ai-chat-messages
    ├── .obsidian-ai-chat-turn.user
    │   ├── .obsidian-ai-chat-role-label   (chrome, non-selectable)
    │   └── .obsidian-ai-chat-body         (selectable — Y1)
    └── .obsidian-ai-chat-turn.assistant
        ├── .obsidian-ai-chat-role-label   (chrome, non-selectable)
        ├── .obsidian-ai-chat-body         (selectable — Y2)
        └── .obsidian-ai-chat-sources      (chips row, non-selectable — Y4)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatView.renderMessages()` | unchanged | current `messages: ChatTurn[]` | Applies class names above; no content format change. |
| Streaming update | `appendDeltaToLastAssistant(delta: string)` | unchanged | On each delta, append into `.obsidian-ai-chat-body` without recreating the parent turn element — preserves selection (Y5). |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Selectable bodies render immediately on each new turn; no blocking overlay. |
| Error | Error text renders inside `.obsidian-ai-chat-body.error` — still selectable. |
| Empty | No messages means no bodies; nothing to select. |
| Streaming | Deltas append into the existing assistant `.obsidian-ai-chat-body`; selection on earlier completed bubbles is preserved (Y5). |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `tests/plugin/ui/ChatView.selection.test.ts` | DOM-level assertions: after `renderMessages`, user and assistant bodies have `user-select: text`; chips/role labels do not; streaming-append does not re-create the turn element. (A1–A4, Y1–Y5). |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/plugin/ui/ChatView.ts` | Wrap each message body in `.obsidian-ai-chat-body`; put role label in a separate `.obsidian-ai-chat-role-label` span. Ensure streaming append targets the existing body element (Y5). |
| 2 | `styles.css` | Add `.obsidian-ai-chat-body { user-select: text; -webkit-user-select: text; }` and `.obsidian-ai-chat-role-label, .obsidian-ai-chat-sources { user-select: none; -webkit-user-select: none; }`. Ensure no ancestor rule overrides (Y3). |

### Files UNCHANGED (confirm no modifications needed)

- All sidecar code — this is renderer-only.
- `src/core/*` — core is unaffected.
- Every other UI component — the fix is scoped to ChatView.

---

## 8. Acceptance Criteria Checklist

### Phase A: Selectable rendering

- [ ] **A1** — User message bodies render inside `.obsidian-ai-chat-body`
  - After `renderMessages`, every `.obsidian-ai-chat-turn.user` has exactly one `.obsidian-ai-chat-body` child containing the user prompt text.
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::A1_user_body_rendered(vitest)`

- [ ] **A2** — Assistant message bodies render inside `.obsidian-ai-chat-body`
  - After a streamed reply completes, the assistant turn has exactly one `.obsidian-ai-chat-body` child containing the concatenated deltas.
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::A2_assistant_body_rendered(vitest)`

- [ ] **A3** — Role labels and source chips are not part of the body
  - `.obsidian-ai-chat-role-label` and `.obsidian-ai-chat-sources` are siblings of `.obsidian-ai-chat-body`, not descendants.
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::A3_chrome_outside_body(vitest)`

- [ ] **A4** — Streaming appends into the existing body element without recreating the turn
  - Between two delta appends, the `.obsidian-ai-chat-turn.assistant` node reference is stable (same DOM node).
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::A4_streaming_preserves_node(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** User message bodies have `getComputedStyle.userSelect === 'text'`
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::Y1_user_body_computed_style(vitest)` — covers S3 (user selection).

- [ ] **Y2** — **(binding)** Assistant message bodies have `getComputedStyle.userSelect === 'text'`
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::Y2_assistant_body_computed_style(vitest)` — covers S3 (assistant selection).

- [ ] **Y3** — **(binding)** No ancestor in the chat pane hierarchy sets `user-select: none` that would override the body rule
  - Walk up from a body element to the chat pane root; no computed `user-select: none` anywhere in the path.
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::Y3_no_ancestor_blocks_selection(vitest)`

- [ ] **Y4** — **(binding)** Source chips and role labels are non-selectable
  - `.obsidian-ai-chat-sources` and `.obsidian-ai-chat-role-label` resolve to `user-select: none`.
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::Y4_chrome_not_selectable(vitest)`

- [ ] **Y5** — **(binding)** Streaming delta append does not clear an existing selection in a completed previous bubble
  - Assert: given two completed assistant bubbles and a third in-progress, selecting text in the first is preserved across a delta append to the third (selection range comparison before/after).
  - Evidence: `tests/plugin/ui/ChatView.selection.test.ts::Y5_streaming_preserves_selection(vitest)` — covers S3 copy/paste expectation under live streaming.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — No relative imports where the project alias applies
- [ ] **Z5** — No logging changes needed (pure rendering change; existing ChatView logs unchanged)
- [ ] **Z6** — `/review-story BUG-2` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/plugin/ui/ChatView.selection.test.ts::A1_user_body_rendered` | A1 | S3 | Happy path — user body exists. |
| 2 | unit | `tests/plugin/ui/ChatView.selection.test.ts::A2_assistant_body_rendered` | A2 | S3 | Happy path — assistant body exists. |
| 3 | unit | `tests/plugin/ui/ChatView.selection.test.ts::A3_chrome_outside_body` | A3 | S3 | Structural — chrome siblings. |
| 4 | unit | `tests/plugin/ui/ChatView.selection.test.ts::A4_streaming_preserves_node` | A4 | S3 | Streaming append is in-place. |
| 5 | unit | `tests/plugin/ui/ChatView.selection.test.ts::Y1_user_body_computed_style` | Y1 | S3 | Binding — computed style check. |
| 6 | unit | `tests/plugin/ui/ChatView.selection.test.ts::Y2_assistant_body_computed_style` | Y2 | S3 | Binding — computed style check. |
| 7 | unit | `tests/plugin/ui/ChatView.selection.test.ts::Y3_no_ancestor_blocks_selection` | Y3 | S3 | Binding — no ancestor override. |
| 8 | unit | `tests/plugin/ui/ChatView.selection.test.ts::Y4_chrome_not_selectable` | Y4 | — | Binding — chrome remains non-selectable. |
| 9 | unit | `tests/plugin/ui/ChatView.selection.test.ts::Y5_streaming_preserves_selection` | Y5 | S3 | Binding — live selection survives delta appends. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | `jsdom` (Vitest) may compute `user-select` differently from Chromium in Obsidian. | Use `getComputedStyle` assertions plus the explicit DOM structure assertions (A1–A4) so structure is correct even if computed-style diverges; a smoke step in Implementation Order verifies in real Obsidian. |
| 2 | A future theme overriding Obsidian core may re-add `user-select: none` at an outer wrapper. | Y3 asserts "no ancestor in the chat pane hierarchy" blocks selection at build time; document in [chat-behavior-tuning.md](../guides/chat-behavior-tuning.md) as a known-good-theme caveat. |
| 3 | Role labels currently share the same container as message text. | Section 7 MODIFY #1 restructures them into a sibling span; A3 covers this. |

---

## Implementation Order

1. `tests/plugin/ui/ChatView.selection.test.ts` — red-first for A1–A4 and Y1–Y5.
2. `src/plugin/ui/ChatView.ts` — split `.obsidian-ai-chat-body` and `.obsidian-ai-chat-role-label`; make streaming append into the existing body node (covers A1–A4, Y5).
3. `styles.css` — add `user-select` rules on body / chrome (covers Y1, Y2, Y4); remove any containing rule that overrides (covers Y3).
4. **Verify** — `npm run test:unit` green; `npm run build` green.
5. **Final verify** — run plugin in a real Obsidian vault, select text in both user and assistant bubbles, copy to clipboard, paste into a note to confirm end-to-end.

---

*Created: 2026-04-21 | Story: BUG-2 | Epic: 11 — Chat accuracy and UX bug fixes (REQ-006)*
