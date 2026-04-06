# TST-1: Unit test scope — core and plugin without native sidecar stack

**Story**: Define and script **`npm run test:unit`** to run Vitest for **`tests/core/**/_.test.ts`** and **`tests/plugin/\*\*/_.test.ts`** only, so CI and local runs can execute **fast, portable** tests without loading **`better-sqlite3` / sqlite-vec** (those stay under TST-2).
**Epic**: 10 — Testing, authoring guide, and release hardening
**Size**: Medium
**Status\*\*: Complete

---

## 1. Summary

Core workflows and the chunker already run against **in-memory fakes** (see existing tests under `tests/core/`). Plugin adapters mock `fetch` or avoid Obsidian runtime. This story **locks that split in `package.json` and README** so “unit” has a single obvious meaning: no sidecar directory tests.

Pointers: [REQUIREMENTS §9](../requirements/REQUIREMENTS.md) quality bar; [ADR-006](../decisions/ADR-006-sidecar-architecture.md) native stack in sidecar only.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                               | Why it binds this story                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md)           | Native SQLite/sqlite-vec is sidecar-only; unit slice excludes that tree. |
| [ADR-001](../decisions/ADR-001-wasm-sqlite-vec-shipped-plugin.md) | Historical context; iter-2 sidecar owns native modules.                  |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] README and `package.json` can be updated without contradicting REQUIREMENTS §12
- [x] Section 4 filled
- [x] Phase Y non-mock evidence path (script name)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `test:unit` must **not** execute any test file under `tests/sidecar/`.
2. **Y2** — `npm run test` remains the **full** suite (unit + integration directories), unless README explicitly documents a different aggregate (default: unchanged `vitest run`).

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

| Path           | Purpose                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `package.json` | Add `test:unit` script                                                         |
| `README.md`    | Document `test:unit` in [Available Scripts](../../README.md#available-scripts) |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `npm run test:unit` completes successfully and runs only `tests/core` and `tests/plugin` tests.
  - Evidence: `package.json` script + `npm run test:unit`

### Phase Y

- [x] **Y1** — **(binding)** No `tests/sidecar/**/*.test.ts` is invoked by `test:unit`.
  - Evidence: `vitest run tests/core tests/plugin` (or equivalent) with no `tests/sidecar` path

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any` in new config
- [x] **Z4** — **N/A** (no client `@shared` alias in this repo)
- [x] **Z5** — **N/A**

---

## 9. Risks & Tradeoffs

| #   | Risk                                                                 | Mitigation                         |
| --- | -------------------------------------------------------------------- | ---------------------------------- |
| 1   | Future tests misplaced under `tests/core` that import native modules | Code review; boundary check script |

---

## Implementation Order

1. Add `test:unit` to `package.json`
2. Update README Available Scripts

---

_Created: 2026-04-05 | Story: TST-1 | Epic: 10_
