# UI-3: `ChatView` — RAG chat pane

**Story**: **`ItemView`** with message list, **bottom textarea**, **Send** calls `streamChat` with **`timeoutMs`** from settings, **Cancel** uses `AbortSignal`, renders **sources** as links; **New conversation** clears history.
**Epic**: 9 — Plugin UI, commands, and agent file operations
**Size**: Large
**Status**: Complete

---

## 1. Summary

[README ChatView](../../README.md#chatview); ADR-009 cancel/timeout.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md) | `signal` + `timeoutMs` |

---

## 3. Definition of Ready (DoR)

- [x] PLG transports implement `streamChat`
- [x] Section 4 filled
- [x] Phase Y

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Pass **`timeoutMs: settings.chatTimeout`** on each chat request.
2. **Y2** — **`apiKey`** from SecretStorage only on payload.

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

| Path | Purpose |
|------|---------|
| `src/plugin/ui/ChatView.ts` | View |

---

## 8. Acceptance Criteria Checklist

- [x] **A1** — `streamChat` consumed; assistant text appended incrementally.
  - Evidence: `ChatView.ts`

### Phase Y

- [x] **Y1** — **(binding)** `timeoutMs` passed from `plugin.settings.chatTimeout`.
  - Evidence: `rg chatTimeout src/plugin/ui/ChatView.ts`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — `Notice` on failure

---

## 9. Risks & Tradeoffs

(n/a)

---

## Implementation Order

1. `ChatView.ts`
2. Register in `main.ts`

---

*Created: 2026-04-05 | Story: UI-3 | Epic: 9*
