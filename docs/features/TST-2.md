# TST-2: Integration tests — sidecar, SQLite, sqlite-vec

**Story**: Define **`npm run test:integration`** to run Vitest for **`tests/sidecar/**/\*.test.ts`**, covering native **`better-sqlite3`**, migrations, adapters, HTTP/stdio servers, and **`SidecarRuntime`** where those tests already live.
**Epic**: 10 — Testing, authoring guide, and release hardening
**Size**: Medium
**Status\*\*: Complete

---

## 1. Summary

Integration coverage already exists under `tests/sidecar/` (document store, queue, job steps, runtime). This story **names and documents** that slice so developers run native-heavy tests deliberately and README matches `package.json` (per Epic 10 plan checkpoint).

Pointers: [ADR-006](../decisions/ADR-006-sidecar-architecture.md); REQUIREMENTS §12.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                     | Why it binds this story                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Sidecar hosts SQLite + sqlite-vec; tests belong in `tests/sidecar`. |

---

## 3. Definition of Ready (DoR)

- [x] Sidecar test tree exists
- [x] Section 4 filled
- [x] Phase Y evidence via script

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `test:integration` must include all Vitest files under `tests/sidecar/`.
2. **Y2** — Running `npm run test:unit` and `npm run test:integration` back-to-back must equal the same cases as `npm run test` (no gaps, no duplicates).

---

## 5–6. (n/a)

---

## 7. File Touchpoints

| Path           | Purpose                                 |
| -------------- | --------------------------------------- |
| `package.json` | Add `test:integration`                  |
| `README.md`    | Document script; remove “later” wording |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `npm run test:integration` passes and executes every `tests/sidecar/**/*.test.ts`.
  - Evidence: `npm run test:integration`

### Phase Y

- [x] **Y1** — **(binding)** Integration script targets only `tests/sidecar` test paths.
  - Evidence: `package.json` + `vitest run tests/sidecar`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — **N/A**

---

## 9. Risks & Tradeoffs

| #   | Risk                                   | Mitigation                             |
| --- | -------------------------------------- | -------------------------------------- |
| 1   | Native module load failures on some OS | Document Node version; CI matrix later |

---

## Implementation Order

1. Add `test:integration` to `package.json`
2. README Available Scripts table

---

_Created: 2026-04-05 | Story: TST-2 | Epic: 10_
