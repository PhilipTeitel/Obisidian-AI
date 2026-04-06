# PLG-6: Vault access — `IVaultAccessPort` in plugin

**Story**: Implement **`IVaultAccessPort`** using Obsidian **`Vault`**: **`listFiles`** returns vault-relative paths for markdown files under configured **`indexedFolders`** (empty = all), respecting **`excludedFolders`**; **`readFile`** reads UTF-8 text via adapter.
**Epic**: 8 — Plugin client, settings, secrets, and vault I/O
**Size**: Medium
**Status**: Complete

---

## 1. Summary

ADR-006: sidecar never reads vault disk. Hash for index payloads: **SHA-256 hex** of UTF-8 bytes ([IncrementalIndexPlanner](../../src/core/workflows/IncrementalIndexPlanner.ts) contract) — **`hashVaultText`** in the plugin (`node:crypto`).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                     | Why it binds this story      |
| ------------------------------------------------------- | ---------------------------- |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Vault access in plugin only. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Implementation lives under **`src/plugin/`** only.
2. **Y2** — Paths are **vault-relative** (`path` uses `/`).
3. **Y3** — **`excludedFolders`** prefix wins over inclusion.

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

| #   | Path                                             | Purpose           |
| --- | ------------------------------------------------ | ----------------- |
| 1   | `src/plugin/vault/ObsidianVaultAccess.ts`        | IVaultAccessPort  |
| 2   | `src/plugin/vault/hashVaultText.ts`              | sha256 hex        |
| 3   | `tests/plugin/vault/ObsidianVaultAccess.test.ts` | path filter logic |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — Given mock files, `listFiles([])` returns all markdown paths.
  - Evidence: `tests/plugin/vault/ObsidianVaultAccess.test.ts::A1_list_all(vitest)`

- [x] **A2** — `excludedFolders` excludes subtree.
  - Evidence: `tests/plugin/vault/ObsidianVaultAccess.test.ts::A2_excluded(vitest)`

### Phase Y

- [x] **Y1** — **(binding)** `implements IVaultAccessPort` or explicit return type satisfies port.
  - Evidence: `npm run typecheck`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

| #   | Risk                       | Mitigation                                |
| --- | -------------------------- | ----------------------------------------- |
| 1   | Performance on huge vaults | Later incremental watcher (out of scope). |

---

## Implementation Order

1. hashVaultText
2. ObsidianVaultAccess
3. Tests

---

_Created: 2026-04-05 | Story: PLG-6 | Epic: 8_
