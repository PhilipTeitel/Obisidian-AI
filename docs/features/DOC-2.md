# DOC-2: User operations — DB location, sync warnings, uninstall

**Story**: Document **default index database location**, **per-vault override**, **risks of cloud/network paths**, and that **uninstall** may **leave DB files** unless the user deletes them (REQUIREMENTS §8).
**Epic**: 10 — Testing, authoring guide, and release hardening
**Size**: Small
**Status**: Complete

---

## 1. Summary

Storage expectations are easy to get wrong (sync services locking SQLite, multiple vaults, leftover disk use). This story adds a concise user-facing doc aligned with [README Plugin Settings](../../README.md#plugin-settings) (`dbPath`) and [SidecarLifecycle](../../src/plugin/client/SidecarLifecycle.ts) default path behavior.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                        | Why it binds this story                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [ADR-004](../decisions/ADR-004-per-vault-index-storage.md) | Per-vault DB location, lazy init, path override.                |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md)    | DB lives with sidecar process expectations, not in plugin WASM. |

---

## 3. Definition of Ready (DoR)

- [x] REQUIREMENTS §8 bullets mapped
- [x] Section 4 filled

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — State default DB path pattern (`~/.obsidian-ai/<vault-derived>.db`) and that **override is per vault** via settings.
2. **Y2** — Explicit warning: **cloud-synced or network filesystems** for the DB file risk **corruption or locking**.
3. **Y3** — Uninstall: **index files may remain** until manually removed.

---

## 5–6. (n/a)

---

## 7. File Touchpoints

| Path                                        | Purpose                  |
| ------------------------------------------- | ------------------------ |
| `docs/guides/user-storage-and-uninstall.md` | New guide                |
| `README.md`                                 | Link from docs / Epic 10 |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `docs/guides/user-storage-and-uninstall.md` addresses Y1–Y3.
  - Evidence: file content review

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — **N/A**
- [x] **Z4** — **N/A**
- [x] **Z5** — **N/A**

---

## 9. Risks & Tradeoffs

(n/a)

---

## Implementation Order

1. Write `docs/guides/user-storage-and-uninstall.md`
2. README link

---

_Created: 2026-04-05 | Story: DOC-2 | Epic: 10_
