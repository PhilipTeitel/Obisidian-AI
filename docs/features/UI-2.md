# UI-2: Search from selection command

**Story**: Command **pre-fills** `SearchView` query from **editor selection** (or empty), activates **same leaf** as UI-1.
**Epic**: 9 — Plugin UI, commands, and agent file operations
**Size**: Small
**Status**: Open

---

## 1. Summary

Palette command registered in [UI-5](UI-5.md) or here; depends on UI-1.

---

## 2. Linked architecture decisions (ADRs)

**None — inherits ADR-006 from epic.**

---

## 3. Definition of Ready (DoR)

- [x] UI-1 view id stable
- [x] Section 4 filled
- [x] Phase Y evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — No duplicate `ItemView` leaves for search type.

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
| `src/plugin/commands/registerCommands.ts` | selection → open search |

---

## 8. Acceptance Criteria Checklist

- [x] **A1** — Command ID registered; opens search leaf with query from selection when non-empty.
  - Evidence: `registerCommands.ts` + `main.ts`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

(n/a)

---

## Implementation Order

1. Extend command registration

---

*Created: 2026-04-05 | Story: UI-2 | Epic: 9*
