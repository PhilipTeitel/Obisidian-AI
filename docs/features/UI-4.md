# UI-4: `ProgressSlideout` — indexing progress

**Story**: **`ItemView`** (or dedicated right leaf) showing **latest `IndexProgressEvent`** lines from transport push demux (stdio) or WS (http) — MVP: **poll `index/status`** on interval when indexing or display last events if stdio push forwarded to plugin in future; **this story** implements a **simple list UI** + **optional** subscription hook on `StdioTransportAdapter` for `channel:push` progress (extend adapter with `onProgress` callback).
**Epic**: 9 — Plugin UI, commands, and agent file operations
**Size**: Medium
**Status**: Complete

---

## 1. Summary

MVP: **polling `index/status`** every 2s while panel visible + manual refresh. Future: wire push from extended transport.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                  | Why it binds this story    |
| -------------------------------------------------------------------- | -------------------------- |
| [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) | `IndexProgressEvent` shape |

---

## 3. Definition of Ready (DoR)

- [x] Sidecar exposes `index/status`
- [x] Section 4 filled

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — No blocking modal; non-modal leaf/view.

---

## 5–6. API / Frontend

(n/a)

---

## 7. File Touchpoints

| Path                                | Purpose     |
| ----------------------------------- | ----------- |
| `src/plugin/ui/ProgressSlideout.ts` | View + poll |

---

## 8. Acceptance Criteria Checklist

- [x] **A1** — View opens; shows JSON or formatted rows from `index/status.jobs` when transport available.
  - Evidence: `ProgressSlideout.ts`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

| #   | Risk      | Mitigation                 |
| --- | --------- | -------------------------- |
| 1   | Poll load | 2s interval; clear on hide |

---

## Implementation Order

1. `ProgressSlideout.ts`

---

_Created: 2026-04-05 | Story: UI-4 | Epic: 9_
