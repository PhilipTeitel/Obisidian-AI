# FND-2: ESLint, Prettier, Vitest config, CI-friendly `test` / `typecheck` / `lint`

**Story**: Add ESLint, Prettier, and Vitest with npm scripts so contributors and CI can run `lint`, `format` (check), `typecheck`, and `test` headlessly.
**Epic**: 1 — Scaffold, toolchain, and domain contracts
**Size**: Small
**Status**: Open

---

## 1. Summary

This story completes the quality gate toolchain for iteration 2. FND-1 provides builds; FND-2 ensures style, static analysis, and a test runner exist before domain and adapter code lands. Scripts must run in CI without Obsidian (no GUI, no Electron).

Prettier owns formatting; ESLint owns correctness and import boundaries. Vitest must align with ESM (`"type": "module"` in `package.json`). Where plugin (renderer) and sidecar (Node) differ, use ESLint `overrides` per glob rather than one misleading global environment.

Requirements touchpoint: [REQUIREMENTS §9](../../docs/requirements/REQUIREMENTS.md) (quality / reliability bar at MVP level). README: [Technical stack — ESLint, Prettier, Vitest](../../README.md#technical-stack).

---

## 2. Linked architecture decisions (ADRs)

**None — this story inherits only epic-level ADRs already linked from the README** (e.g. [ADR-006](../../docs/decisions/ADR-006-sidecar-architecture.md) for sidecar vs plugin separation). No ADR governs ESLint vs Biome; tooling choice is implementation detail as long as gates are reproducible.

| ADR | Why it binds this story |
|-----|-------------------------|
| *(none for this story)* | Tooling only; epic-level ADRs in README still bound the repo (e.g. ADR-006 for native code in sidecar only). |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted** (N/A — no story-specific ADR required)
- [x] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [x] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [x] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

*Planning note: No **Tensions / conflicts** identified.*

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `npm run test`, `npm run lint`, and `npm run typecheck` must exit 0 on a clean tree and be safe to run in CI (no network required for default test run).
2. **Y2** — Formatting is enforced by Prettier; ESLint must not fight Prettier rules (use `eslint-config-prettier` or equivalent for overlap rules).
3. **Y3** — Vitest configuration must use ESM consistent with repository `package.json` `"type": "module"`.
4. **Y4** — `src/core/` must remain free of `better-sqlite3` and `obsidian` imports — enforce via ESLint `no-restricted-imports` (or equivalent) matching FND-1 **B2** intent.
5. **Y5** — README [Available Scripts](../../README.md#available-scripts) documents `test`, `typecheck`, `lint`, and any `format` / `format:check` scripts added here.

---

## 5. API Endpoints + Schemas

No HTTP APIs or IPC contracts. No new application types in `shared/types.ts` (not used in this repo).

```ts
// No new exported contract types required for FND-2.
```

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

Not applicable. No Obsidian UI components are added; lint environment may reference `src/plugin/**/*.ts` for browser-ish globals via ESLint `overrides`.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `eslint.config.js` or `eslint.config.mjs` | Flat config (ESLint 9+) with TypeScript parser/plugin; overrides for `src/plugin` vs `src/sidecar`. |
| 2 | `.prettierrc` or `prettier` key in `package.json` | Formatting defaults. |
| 3 | `.prettierignore` | Exclude build outputs, `node_modules`, Obsidian `main.js` if generated at root. |
| 4 | `vitest.config.ts` | Vitest projects or `include` for `src/**/*.test.ts`. |
| 5 | `src/core/health.test.ts` (or `src/__tests__/health.test.ts`) | Minimal always-pass smoke test so `npm test` has deterministic body. |

### Files to MODIFY

| # | Path | Change |
|---|------|---------|
| 1 | `package.json` | Add devDependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `vitest`; scripts: `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`. |
| 2 | `README.md` | Document scripts in Available Scripts. |

### Files UNCHANGED (confirm no modifications needed)

- `docs/decisions/*` — no new ADR for lint/test tooling.
- `docs/requirements/REQUIREMENTS.md` — baseline only.

---

## 8. Acceptance Criteria Checklist

### Phase A: Prettier

- [ ] **A1** — `npm run format:check` (or `prettier --check .`) passes on the repo after formatting is applied once.
  - Verification: Run format check in CI.
  - Evidence: `package.json` script + CI log

### Phase B: ESLint

- [ ] **B1** — `npm run lint` runs ESLint on all `src/**/*.ts` (and config files if included) with zero errors.
  - Verification: Local and CI.
  - Evidence: `eslint.config.mjs(npm run lint)`

- [ ] **B2** — ESLint `no-restricted-imports` (or stricter) blocks `obsidian` and `better-sqlite3` imports under `src/core/**`.
  - Verification: Attempted import in a test branch fails lint.
  - Evidence: `eslint.config.mjs` rule block + optional `src/core/.eslintrc` override snippet in config

### Phase C: Typecheck

- [ ] **C1** — `npm run typecheck` runs `tsc --noEmit` for all TS projects introduced in FND-1 (composite or multiple `-p` flags documented).
  - Verification: Single command exits 0.
  - Evidence: `package.json` `typecheck` script output

### Phase D: Vitest

- [ ] **D1** — `npm run test` runs Vitest; at least one test file exists and passes.
  - Verification: CI runs `npm test`.
  - Evidence: `src/core/health.test.ts::smoke(vitest)` (exact test name as implemented)

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `package.json` lists `vitest`, `eslint`, `prettier`, and `typescript` (or `typescript-eslint` meta) as devDependencies with pinned or lockfile-resolved versions committed.
  - Verification: `npm ci` reproducible; lockfile present if team uses one.
  - Evidence: `package.json` + `package-lock.json` or `pnpm-lock.yaml` as applicable

- [ ] **Y2** — **(binding)** Default `npm test` does not hit the network (no live API tests in this story).
  - Verification: Grep vitest files for `fetch(` / `axios` — none; or run tests with network disabled.
  - Evidence: `rg "fetch\\(|axios" src/**/*.test.ts` exit 1 or CI env `NODE_OPTIONS` documented

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all configured TS projects
  - Evidence: `npm run build` after FND-1 merge

- [ ] **Z2** — `npm run lint` passes (or only pre-existing warnings documented in PR)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file for this story (configs exempt if unavoidable — prefer typed eslint config)
  - Evidence: PR diff review + optional `@typescript-eslint/no-explicit-any`

- [ ] **Z4** — **N/A** — No `@shared/types` alias; imports remain relative or path-mapped per repo convention only if added in FND-3+.

- [ ] **Z5** — **N/A** — No new application logging; tooling only. Optional: eslint rule for `no-console` in `src/core` deferred to later stories.

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | ESLint 8 vs 9 config format confusion | Document chosen major version in README Prerequisites. |
| 2 | Obsidian globals unknown to ESLint | Use `overrides` for `src/plugin` with appropriate `globals` or `env`. |
| 3 | Vitest vs Node `test` built-ins | Standardize on Vitest only per README stack. |

---

## Implementation Order

1. `package.json` — Add devDependencies and scripts (**A1**, **C1**, **D1**, **Y1**).
2. `.prettierrc`, `.prettierignore` — Format baseline (**A1**).
3. `eslint.config.mjs` — Rules + core import restrictions (**B1**, **B2**).
4. `vitest.config.ts` + minimal `*.test.ts` (**D1**).
5. **Verify** — `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
6. `README.md` — Available Scripts (**Y5**, **A2** from epic perspective).

---

*Created: 2026-04-04 | Story: FND-2 | Epic: 1 — Scaffold, toolchain, and domain contracts*
