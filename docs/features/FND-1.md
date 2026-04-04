# FND-1: Monorepo layout, `tsconfig` split, esbuild for plugin and sidecar, npm scripts

**Story**: Establish the repository layout, split TypeScript projects, dual esbuild pipelines (plugin + sidecar), and npm scripts so CI and developers can build both artifacts deterministically.
**Epic**: 1 — Scaffold, toolchain, and domain contracts
**Size**: Medium
**Status**: Open

---

## 1. Summary

This story lays the physical and build-time foundation for iteration 2: a thin Obsidian plugin bundle, a portable `src/core/` tree, and a Node.js sidecar that may use native modules. Without a correct split, native SQLite code could leak into the renderer bundle (violating platform constraints), or the domain layer could accidentally depend on Obsidian or Node-only APIs.

The layout and scripts must match the structure documented in the README [Project structure](../../README.md#project-structure). Downstream stories (FND-2 quality gates, FND-3 ports, then STO/QUE/SRV work) assume this scaffold exists.

The guiding constraint is **separation of artifacts**: the plugin output is a single-file (or documented) Obsidian loadable bundle with **no** `better-sqlite3` / `sqlite-vec` / other sidecar-native code; the sidecar output is a Node ≥ 18 entry suitable for native addons. TypeScript project boundaries enforce compile-time separation for `src/core/` where possible.

Canonical requirements: [REQUIREMENTS §12–§13](../../docs/requirements/REQUIREMENTS.md) (technology and architecture). Binding architecture: [ADR-006](../../docs/decisions/ADR-006-sidecar-architecture.md) (sidecar vs plugin).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-006-sidecar-architecture.md](../../docs/decisions/ADR-006-sidecar-architecture.md) | Heavy compute and native modules live in the sidecar; the plugin ships no native addons; vault filesystem stays plugin-side. |
| [docs/decisions/ADR-001-wasm-sqlite-vec-shipped-plugin.md](../../docs/decisions/ADR-001-wasm-sqlite-vec-shipped-plugin.md) | **Superseded** context only — confirms why the plugin must not ship SQLite/native vector stacks. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [x] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [x] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [x] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

*Planning note: No **Tensions / conflicts** identified between README, REQUIREMENTS, and accepted ADRs for this story.*

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — The Obsidian plugin distributable must not bundle or load native addons (`better-sqlite3`, `sqlite-vec`, or other `.node` sidecar-only dependencies). Sidecar-only dependencies must be externalized or excluded from the plugin esbuild graph.
2. **Y2** — Sidecar runtime target is **Node.js ≥ 18** per REQUIREMENTS; build output must be runnable with that engine.
3. **Y3** — Repository layout must include `src/plugin/`, `src/core/`, and `src/sidecar/` as top-level source roots under `src/`, consistent with README (exact filenames for entries may be minimal stubs in this story).
4. **Y4** — `src/core/` must typecheck without importing Obsidian APIs or sidecar-native database modules (enforced via `tsconfig` `include`/`exclude` and/or path boundaries; see Phase Y).
5. **Y5** — `npm run build` (or explicitly documented equivalent scripts) must produce **both** plugin and sidecar artifacts in one invocation or via documented sub-scripts.

---

## 5. API Endpoints + Schemas

No HTTP or IPC message schemas are introduced or changed in this story. Build layout and TypeScript/esbuild configuration only. No new shared contract types beyond optional empty module stubs for compilation.

```ts
// No new exported contract types required for FND-1.
```

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

Not applicable. This story does not add or modify Obsidian views, settings UI, or CSS. Scaffold may include a minimal `src/plugin/main.ts` entry stub only to validate the plugin bundle.

### 6b. Props & Contracts

Not applicable — no UI components in scope.

### 6c. States (Loading / Error / Empty / Success)

Not applicable — no UI in scope.

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/plugin/main.ts` | Minimal plugin entry exporting a stub `Plugin` class (or equivalent) so esbuild has a real target. |
| 2 | `src/core/.gitkeep` or `src/core/index.ts` | Placeholder so `src/core/` exists; optional barrel. |
| 3 | `src/sidecar/server.ts` | Minimal sidecar entry (e.g. `console.log` or empty `main`) for esbuild/tsc target. |
| 4 | `esbuild.config.mjs` | Plugin bundle: Obsidian-oriented format (IIFE or documented), outfile aligned with `manifest.json`. |
| 5 | `esbuild.sidecar.mjs` | Sidecar bundle: Node platform, appropriate external list for future native deps. |
| 6 | `tsconfig.json` | Base strict config; references or paths as needed. |
| 7 | `tsconfig.sidecar.json` | Sidecar compilation boundaries (Node). |
| 8 | `tsconfig.plugin.json` | Plugin compilation boundaries (DOM/lib appropriate to Obsidian/Electron renderer). |
| 9 | `scripts/verify-plugin-bundle.mjs` | **(binding)** Script that fails if plugin output contains forbidden substrings or patterns (e.g. `better-sqlite3`, `sqlite-vec`, `.node` require paths) — implementer defines exact checks. |

### Files to MODIFY

| # | Path | Change |
|---|------|---------|
| 1 | `package.json` | Add `build`, `build:plugin`, `build:sidecar` (or equivalent), dependencies: `typescript`, `esbuild`, `@types/node` as needed. |
| 2 | `README.md` | [Available Scripts](../../README.md#available-scripts): document new scripts; keep backlog link to this file in Epic 1 table. |
| 3 | `manifest.json` | Ensure `main` path matches plugin esbuild output if required. |

### Files UNCHANGED (confirm no modifications needed)

- `docs/requirements/REQUIREMENTS.md` — requirements baseline; not altered by scaffold.
- `docs/decisions/*.md` — ADRs already accepted; no new ADR required for layout-only work.

---

## 8. Acceptance Criteria Checklist

### Phase A: Repository layout

- [ ] **A1** — `src/plugin/`, `src/core/`, and `src/sidecar/` exist with at least one TypeScript source file each that participates in `npm run build`.
  - Verification: Directory listing and successful compile of all three roots.
  - Evidence: `package.json` scripts and CI/local log showing three outputs or unified build touching all three.

- [ ] **A2** — README [Project structure](../../README.md#project-structure) matches the implemented layout, or this story document’s **File Touchpoints** section documents any intentional deviation.
  - Verification: Diff review between tree and README diagram.
  - Evidence: `docs/features/FND-1.md` (this file) + README section updated in same PR.

### Phase B: TypeScript split

- [ ] **B1** — Separate tsconfig projects (or composite) exist for plugin and sidecar such that sidecar can use Node types without forcing them into the plugin program.
  - Verification: `npx tsc -p tsconfig.plugin.json --noEmit` and `npx tsc -p tsconfig.sidecar.json --noEmit` both succeed (names may vary if documented).
  - Evidence: `tsconfig.plugin.json`, `tsconfig.sidecar.json` (vitest/tsc CLI in CI).

- [ ] **B2** — `src/core/` is included in a project that does not list Obsidian or `better-sqlite3` as types/imports in its default graph (no accidental `obsidian` import in core).
  - Verification: Grep `src/core` for `from 'obsidian'` and `better-sqlite3` — zero results.
  - Evidence: `rg "from 'obsidian'|better-sqlite3" src/core` exit 1 (no matches) in CI script or documented manual step.

### Phase C: esbuild outputs

- [ ] **C1** — Plugin esbuild produces the file referenced by `manifest.json` (`main` field) and the file loads in Obsidian when symlinked or copied to a test vault (smoke: no immediate load error).
  - Verification: Build artifact exists; optional manual Obsidian smoke.
  - Evidence: `esbuild.config.mjs` outfile + `manifest.json` cross-check script or documented checklist.

- [ ] **C2** — Sidecar esbuild produces a Node-runnable entry (e.g. `node dist/sidecar/...js` exits 0 or runs stub).
  - Verification: Run built artifact with Node ≥ 18.
  - Evidence: `package.json` script `build:sidecar` + one-line smoke in `scripts/` or CI log.

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** Plugin bundle verification script passes: forbidden native/SQLite stack strings absent from plugin output (per section 4 **Y1**).
  - Verification: `node scripts/verify-plugin-bundle.mjs` exits 0 after `npm run build`.
  - Evidence: `scripts/verify-plugin-bundle.mjs(npm run verify:plugin-bundle)` — add `verify:plugin-bundle` npm script if not aliased.

- [ ] **Y2** — **(binding)** `package.json` `engines.node` is set to `>=18` (or documented equivalent enforcement) for the sidecar consumer.
  - Verification: Read `package.json`.
  - Evidence: `package.json` lists `"engines": { "node": ">=18" }`.

- [ ] **Y3** — **(binding)** Plugin `package.json` dependencies do not list `better-sqlite3` or `sqlite-vec` as runtime deps of the plugin artifact path (they may appear only as sidecar deps if using a single package.json — then they must not be imported from `src/plugin/`).
  - Verification: `npm ls` / grep imports from `src/plugin`.
  - Evidence: `rg "better-sqlite3|sqlite-vec" src/plugin` exit 1; plus `package.json` dependency review.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all configured TS projects for this repo
  - Evidence: CI or local log of `npm run build`

- [ ] **Z2** — `npm run lint` passes **or** criterion deferred: if ESLint is not yet introduced, state **N/A — complete FND-2 Z2** and leave unchecked until FND-2 merges
  - Evidence: `npm run lint` (after FND-2) or explicit N/A note in PR description linking FND-2

- [ ] **Z3** — No `any` types in any new or modified TypeScript file for this story
  - Evidence: `rg ": any" src/` on touched files (should be empty) or ESLint `@typescript-eslint/no-explicit-any`

- [ ] **Z4** — **N/A — repository convention**: This project does not use a `@shared/types` alias. New types introduced in this story must live under `src/core/` or story-local modules only; no ad hoc `any` workarounds.
  - Evidence: PR review note confirming no `@shared/types` requirement

- [ ] **Z5** — **N/A** for FND-1 — no production logging paths are required beyond optional stub entries; FND-2+ may add lint rules. If a stub `main.ts` logs on load, use `console` only behind a clear dev comment or omit.

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Single `package.json` makes it easy to accidentally import sidecar deps from plugin code. | `verify-plugin-bundle.mjs` + grep gates in **Y1**/**Y3**; ESLint `no-restricted-imports` in FND-2. |
| 2 | Obsidian typings/version skew | Pin `obsidian` dev dependency to a documented minimum; document in README when raising floor. |
| 3 | esbuild `platform` / `format` misconfiguration yields unloadable plugin | Cross-check with official Obsidian plugin sample and `manifest.json` `main`. |

---

## Implementation Order

1. `package.json` — Add TypeScript, esbuild, scripts, `engines.node` (covers **Y2**, **Z1** foundation).
2. `tsconfig.json`, `tsconfig.plugin.json`, `tsconfig.sidecar.json` — Split projects (covers **B1**).
3. `src/plugin/main.ts`, `src/sidecar/server.ts`, `src/core/index.ts` — Minimal entries (covers **A1**).
4. `esbuild.config.mjs`, `esbuild.sidecar.mjs` — Outfiles aligned with `manifest.json` (covers **C1**, **C2**).
5. `scripts/verify-plugin-bundle.mjs` + npm script — Plugin bundle gate (covers **Y1**).
6. **Verify** — `npm run build`, `node scripts/verify-plugin-bundle.mjs`, `rg` checks for **B2**, **Y3**.
7. `README.md` — Available Scripts + structure sync (covers **A2**).
8. **Final verify** — Full build; confirm Epic 1 table still links [FND-1](FND-1.md).

---

*Created: 2026-04-04 | Story: FND-1 | Epic: 1 — Scaffold, toolchain, and domain contracts*
