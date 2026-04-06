# AGT-1: Agent note writes — allowed folders + max size

**Story**: Service **`writeAgentNote(vaultPath, markdown)`** creates/updates a note **only** if vault-relative folder is under **`agentOutputFolders`** and **`markdown.length ≤ maxGeneratedNoteSize`** ([README §16](../../README.md#16-agent-file-operations)); distinct from **`indexedFolders`**.
**Epic**: 9 — Plugin UI, commands, and agent file operations
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Used by future chat tool-calling; MVP exposes **tested** pure validation + `Vault.create`/`modify` wrapper behind interface.

---

## 2. Linked architecture decisions (ADRs)

**None — README §16.**

---

## 3. Definition of Ready (DoR)

- [x] Settings contain `agentOutputFolders` + `maxGeneratedNoteSize`
- [x] Section 4 filled

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Reject paths outside allow-list (prefix match).
2. **Y2** — Reject when length > max.

---

## 5–6. (n/a)

---

## 7. File Touchpoints

| Path | Purpose |
|------|---------|
| `src/plugin/agent/validateAgentPath.ts` | pure validation |
| `src/plugin/agent/AgentNoteWriter.ts` | vault I/O |

---

## 8. Acceptance Criteria Checklist

- [x] **A1** — `validateAgentPath` returns error for `../escape` and for folder not allowed.
  - Evidence: `src/plugin/agent/validateAgentPath.test.ts`

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

1. `validateAgentPath.ts` + test
2. `AgentNoteWriter.ts`

---

*Created: 2026-04-05 | Story: AGT-1 | Epic: 9*
