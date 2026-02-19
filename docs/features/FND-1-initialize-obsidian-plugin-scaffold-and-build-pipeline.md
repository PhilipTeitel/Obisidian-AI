# FND-1: Initialize Obsidian plugin scaffold and build pipeline

**Story**: Establish the initial Obsidian plugin codebase structure and toolchain so the project can build, lint, and test from day one.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Small
**Status**: Open

---

## 1. Summary

This story creates the baseline technical scaffold for the Obsidian AI plugin: plugin manifest files, TypeScript source entrypoint, and build/test/lint/typecheck scripts. The goal is to produce a reproducible developer workflow where contributors can run a single set of commands and reliably generate `main.js` for Obsidian plugin loading.

FND-1 is the dependency foundation for all subsequent stories in Epic 1 and beyond. Without a working scaffold and toolchain, later work such as lifecycle wiring, services, providers, and UI panes cannot be implemented or validated. FND-2 and later stories assume this story is complete and stable.

The guiding constraint is to keep the scaffold minimal but production-aligned: enough structure to avoid rework, while deferring feature behavior (view registration, commands, indexing/chat logic) to later stories. This keeps story boundaries clean and preserves fast iteration.

---

## 2. API Endpoints + Schemas

No API endpoint changes are needed for this story.

This project is an Obsidian plugin and FND-1 only establishes local project/build scaffolding. There are no REST routes and no `shared/types.ts` contract updates in scope for this story.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Obsidian App
└── Community Plugin Loader
    ├── manifest.json (plugin metadata)
    ├── versions.json (minimum compatible Obsidian version)
    └── main.js (built artifact from src/main.ts via esbuild)
        └── ObsidianAIPlugin extends Plugin (minimal shell)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAIPlugin` | `class ObsidianAIPlugin extends Plugin` | Plugin lifecycle state managed by Obsidian | Minimal `onload`/`onunload` shell only; functional registrations happen in later stories |
| Build pipeline | `npm run build` -> emits `main.js` | Build success/failure | Uses esbuild + TypeScript entrypoint |
| Lint pipeline | `npm run lint` | Pass/fail output | Validates coding standards from start |
| Test pipeline | `npm run test` | Pass/fail output | Baseline test harness (can be placeholder smoke test) |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Build/lint/test command is running in terminal; no in-plugin UI behavior in scope |
| Error   | Command exits non-zero with actionable output (e.g., TS compile error, lint violation) |
| Empty   | No plugin features exposed yet beyond scaffold; this is expected for FND-1 |
| Success | `main.js` is generated, plugin loads in Obsidian without runtime crash, and toolchain commands pass |

No user-facing frontend pane work is required in this story; this section documents the developer/runtime flow for scaffold validation.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `package.json` | Define project metadata, scripts (`dev`, `build`, `lint`, `test`, `typecheck`), and dependencies |
| 2 | `tsconfig.json` | TypeScript compiler configuration for Obsidian plugin source |
| 3 | `esbuild.config.mjs` | Build pipeline that compiles `src/main.ts` into plugin `main.js` |
| 4 | `manifest.json` | Obsidian plugin manifest metadata (id, name, version, minAppVersion, description, author) |
| 5 | `versions.json` | Obsidian plugin compatibility map for release versions |
| 6 | `.eslintrc.cjs` | ESLint configuration for TypeScript source |
| 7 | `.eslintignore` | Exclude build artifacts and generated files from linting |
| 8 | `vitest.config.ts` | Test runner configuration for baseline unit tests |
| 9 | `src/main.ts` | Minimal plugin entrypoint class extending `Plugin` |
| 10 | `src/types.ts` | Initial shared internal plugin type placeholders used by upcoming stories |
| 11 | `src/__tests__/smoke.test.ts` | Baseline smoke test validating test harness execution |
| 12 | `.gitignore` | Ignore `node_modules`, build output, and local dev artifacts |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `README.md` | Optional only if implementation adds setup notes; no architecture/backlog edits in this story |

### Files UNCHANGED (confirm no modifications needed)

- `docs/prompts/initial.md` — requirements source remains unchanged
- `docs/features/FND-1-initialize-obsidian-plugin-scaffold-and-build-pipeline.md` — this plan file is created during planning, not implementation
- `docs/features/.gitkeep` — keep unless repository policy explicitly removes it when first story file exists

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Scaffold Files

- [ ] **A1** — Obsidian plugin metadata files are present and valid
  - `manifest.json` and `versions.json` exist with consistent version values and a valid `minAppVersion`.
  - Plugin metadata allows Obsidian to detect the plugin without schema errors.

- [ ] **A2** — TypeScript source scaffold is created
  - `src/main.ts` exports a default plugin class extending Obsidian `Plugin`.
  - `onload()` and `onunload()` exist as minimal lifecycle hooks with no feature registrations beyond placeholders.

- [ ] **A3** — Baseline project configuration is committed
  - `package.json`, `tsconfig.json`, and `.gitignore` exist and are internally consistent.
  - Repository can install dependencies with a single `npm install`.

### Phase B: Build Pipeline Wiring

- [ ] **B1** — Build configuration compiles plugin entrypoint
  - `esbuild.config.mjs` compiles `src/main.ts` into `main.js` in the repo root.
  - `npm run build` exits 0 and produces fresh output.

- [ ] **B2** — Watch/dev script is available
  - `npm run dev` runs esbuild in watch mode without immediate runtime errors.
  - File changes in `src/` trigger rebuilds.

- [ ] **B3** — Output artifact is Obsidian-compatible
  - `main.js` can be copied/symlinked with `manifest.json` into a vault plugin folder.
  - Enabling plugin in Obsidian does not crash at startup.

### Phase C: Lint, Typecheck, and Test Baseline

- [ ] **C1** — Linting is configured and runnable
  - `.eslintrc.cjs` and `.eslintignore` are present and target TypeScript files.
  - `npm run lint` exits 0 on initial scaffold.

- [ ] **C2** — Typecheck command validates the scaffold
  - `npm run typecheck` runs `tsc --noEmit` (or equivalent) and exits 0.
  - Obsidian typings resolve without manual patching.

- [ ] **C3** — Test harness executes baseline test
  - `vitest.config.ts` is configured and `npm run test` executes at least one smoke test.
  - Test command exits 0 in local development environment.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Over-scaffolding now can lock in choices before feature requirements are implemented | Keep FND-1 minimal; only add files and config needed for immediate build/lint/test flow |
| 2 | Obsidian API typing/version mismatch can break compile or runtime load | Pin minimum compatible Obsidian typings and align `manifest.json` `minAppVersion` with README decision |
| 3 | Build output format may be incompatible with Obsidian plugin loader if misconfigured | Validate generated `main.js` by loading in a local test vault before marking story complete |
| 4 | Template quality gate `Z4` references client/shared aliases not used in this plugin-only codebase | Keep gate for template compliance; treat as not-applicable check during implementation notes |

---

## Implementation Order

1. `package.json`, `tsconfig.json`, `.gitignore` — initialize Node/TypeScript project metadata and scripts (covers A3).
2. `manifest.json`, `versions.json` — add Obsidian plugin metadata and compatibility mapping (covers A1).
3. `src/main.ts` — create minimal plugin class with lifecycle hooks (covers A2).
4. `esbuild.config.mjs` — configure build and watch outputs to generate `main.js` (covers B1, B2).
5. `.eslintrc.cjs`, `.eslintignore` — configure linting for current and future TypeScript files (covers C1).
6. `vitest.config.ts`, `src/__tests__/smoke.test.ts` — wire baseline test execution (covers C3).
7. **Verify** — run `npm install`, `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run test` (covers B1, C1, C2, C3, Z1, Z2, Z3).
8. **Verify in Obsidian** — symlink/copy `main.js`, `manifest.json`, `styles.css` (if present) to a test vault plugin folder and enable plugin (covers B3).
9. **Final verify** — rerun full command suite and confirm no unplanned file edits outside scaffold scope (covers Phase Z).

---

*Created: 2026-02-19 | Story: FND-1 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
