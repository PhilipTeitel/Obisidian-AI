# UI-1: `SearchView` — semantic search pane

**Story**: Register an **`ItemView`** with search input, **Search** action calling `ISidecarTransport.send({ type: 'search', payload })` with **`k`** from settings and **`apiKey`** from SecretStorage, render **result cards** (path, snippet, score), **click → open file**, **selectable** snippet text.
**Epic**: 9 — Plugin UI, commands, and agent file operations
**Size**: Large
**Status**: Open

---

## 1. Summary

Implements [README SearchView](../../README.md#searchview). Reuses **single leaf** instance (`getLeavesOfType`).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Transport + vault context in plugin. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] README alignment
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — No direct `fetch` to OpenAI from view — only `transport.send('search')`.
2. **Y2** — **`user-select: text`** on snippet containers (CSS).

---

## 5. API Endpoints + Schemas

(n/a — uses existing `SearchRequest` / `SearchResponse`)

---

## 6. Frontend Flow

### 6a

```
SearchView → plugin.lifecycle.getTransport()?.send
```

### 6b

| Component | Notes |
|-----------|-------|
| SearchView | `ItemView`; holds `input`, `button`, `results` container |

### 6c

| State | UI |
|-------|-----|
| Empty | placeholder |
| Error | `Notice` or inline |
| Success | cards |

---

## 7. File Touchpoints

| Path | Purpose |
|------|---------|
| `src/plugin/ui/SearchView.ts` | View |
| `src/plugin/ui/searchView.css` | optional inline styles via `addClass` |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — View type constant unique; `registerView` + `getViewType` match.
  - Evidence: `src/plugin/main.ts` registers view (manual / integration)

### Phase Y

- [x] **Y1** — **(binding)** Search uses `send({ type: 'search', ... })` only.
  - Evidence: `rg "type: 'search'" src/plugin/ui/SearchView.ts`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — Errors surfaced via `Notice`

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | No transport | Disable button + Notice |

---

## Implementation Order

1. `SearchView.ts`
2. Register in `main.ts`

---

*Created: 2026-04-05 | Story: UI-1 | Epic: 9*
