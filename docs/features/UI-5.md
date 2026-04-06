# UI-5: Commands — index, open panes

**Story**: Register commands: **reindex vault** (full index payload from vault), **incremental index** (stub or same as full for MVP), **open search**, **open chat**, **open progress**.
**Epic**: 9 — Plugin UI, commands, and agent file operations
**Size**: Small
**Status**: Open

---

## 1. Summary

Uses `ObsidianVaultAccess`, `hashVaultText`, `getOpenAIApiKey`, `transport.send`.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Plugin reads vault |

---

## 3. Definition of Ready (DoR)

- [x] PLG-6 vault access
- [x] Section 4 filled

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Index payloads use **SHA-256 hex** content hash per PLG-6.

---

## 5–6. (n/a)

---

## 7. File Touchpoints

| Path | Purpose |
|------|---------|
| `src/plugin/commands/registerCommands.ts` | all commands |

---

## 8. Acceptance Criteria Checklist

- [x] **A1** — At least **4** commands registered with unique ids.
  - Evidence: `rg addCommand src/plugin/commands/registerCommands.ts`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — `Notice` on sidecar errors

---

## 9. Risks & Tradeoffs

(n/a)

---

## Implementation Order

1. `registerCommands.ts`
2. `main.ts` calls it

---

*Created: 2026-04-05 | Story: UI-5 | Epic: 9*
