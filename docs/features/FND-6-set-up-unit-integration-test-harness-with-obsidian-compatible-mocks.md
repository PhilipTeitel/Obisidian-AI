# FND-6: Set up unit/integration test harness with Obsidian-compatible mocks

**Story**: Establish a reusable Vitest harness that can run unit and integration tests against plugin/runtime behavior using deterministic Obsidian-compatible mocks instead of source-string assertions.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story upgrades the current test strategy from mostly compile/source-level smoke checks to executable runtime tests that model Obsidian behavior. Today, the suite validates many contracts by reading TypeScript source strings, which is useful for scaffolding but does not provide confidence that lifecycle wiring, command callbacks, or service interactions behave correctly at runtime.

FND-6 introduces a shared test harness with explicit mocks for Obsidian primitives (plugin base class, workspace leaves, notice delivery, command registration, and selection access). The goal is to make plugin and service tests deterministic, lightweight, and independent of a real Obsidian instance while still preserving realistic integration seams.

This story is a dependency for later service-level and command-level stories across indexing, storage, search, and chat epics. Those stories will need to validate runtime behavior (success/failure states, command orchestration, and notices) without brittle ad-hoc stubs in each test file.

The guiding constraint is high-signal coverage without over-simulating Obsidian internals. Mocks should implement only the subset of API surface used by this plugin, with strict defaults that fail loudly when tests access unsupported behavior.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

No changes to `shared/types.ts` or production domain schemas are required. FND-6 adds test-only harness utilities and mock contracts under `src/__tests__/**`, leaving runtime/public type contracts unchanged.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Vitest Runner
├── setup file (global obsidian module mock)
│   └── vi.mock("obsidian", ...) with deterministic class/function shims
├── test harness factory
│   ├── createMockApp() / createMockWorkspace() / createMockLeaf()
│   ├── command registry capture (addCommand calls)
│   ├── notice capture (Notice messages)
│   └── selection + leaf-state controls for test scenarios
├── unit tests (services/providers/errors)
│   └── direct class-level behavior assertions with typed deps
└── integration tests (plugin lifecycle + commands)
    ├── instantiate plugin with mock app + manifest
    ├── run onload()/command callbacks/onunload()
    └── assert runtime effects: notices, view activation, progress status, disposal
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `mockObsidianModule` | Vitest setup module exporting mocked `Plugin`, `Notice`, `MarkdownView`, `PluginSettingTab`, `Setting` | Shared test singleton state | Provides minimum API shape required by current plugin code paths |
| `createMockAppHarness` | `() => { app, workspace, notices, commands, leaves, setSelection }` | Mutable per-test runtime state | Captures command registration, active selection, and view leaf behavior |
| `createPluginTestHarness` | `() => { plugin, appHarness, runOnload, runOnunload, invokeCommand }` | Plugin lifecycle pending/loaded/unloaded | Standard entrypoint for integration tests to reduce repeated setup |
| Service unit specs | Class constructor deps + fake collaborators | Service disposed/not disposed + operation result | Covers `IndexingService`, `SearchService`, `AgentService`, `ChatService`, `ProviderRegistry` behavior |
| Integration command specs | Command id + optional selection/mock failures | command success/failure/no-selection | Verifies notices, logger side effects (where assertable), and progress snapshot transitions |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Test boots harness, registers views/commands/settings, and initializes runtime container via `onload()` |
| Error   | Mocked service or workspace failure triggers normalized error path and captured notice/log assertions |
| Empty   | No active selection or no pre-existing leaves yields expected fallback behavior without runtime crash |
| Success | Command callback and lifecycle paths execute against mocks with deterministic assertions and no source-string probing |

Frontend UI implementation is not directly changed in this story; the focus is runtime testability for existing shell behavior.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/setup/mockObsidianModule.ts` | Centralized `obsidian` module mock used by Vitest setup to emulate plugin/runtime primitives |
| 2 | `src/__tests__/harness/createMockAppHarness.ts` | Build reusable typed mock app/workspace/leaf/notice/command registries |
| 3 | `src/__tests__/harness/createPluginTestHarness.ts` | Provide lifecycle helpers (`runOnload`, `invokeCommand`, `runOnunload`) for integration tests |
| 4 | `src/__tests__/unit/services.runtime.test.ts` | Unit tests for service contracts and disposal/guard behavior using typed fakes |
| 5 | `src/__tests__/integration/plugin.runtime.test.ts` | Integration tests for plugin lifecycle + command wiring with Obsidian-compatible mocks |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `vitest.config.ts` | Register setup file(s) for global `obsidian` mocks and ensure deterministic test environment config |
| 2 | `src/__tests__/smoke.test.ts` | Keep lightweight compile/contract smoke checks, but remove source-string checks now covered by executable integration tests |
| 3 | `README.md` | Update backlog row for `FND-6` to link to this story plan document |

### Files UNCHANGED (confirm no modifications needed)

- `src/main.ts` — production plugin logic should remain unchanged; this story adds test harness support only
- `src/bootstrap/bootstrapRuntimeServices.ts` — runtime bootstrap behavior is validated by tests but not refactored in FND-6
- `src/types.ts` — no production type-contract expansion is required for harness-only work

---

## 5. Acceptance Criteria Checklist

### Phase A: Harness and Mock Foundation

- [x] **A1** — Obsidian module mock is centralized and deterministic
  - A single setup-backed mock provides `Plugin`, `Notice`, `MarkdownView`, `PluginSettingTab`, and `Setting` behavior required by the plugin shell.
  - Unsupported API usage fails clearly (explicit throw or assertion) so future stories do not silently rely on incomplete mocks.

- [x] **A2** — Reusable app/workspace harness factory is available
  - Tests can construct an isolated mock app with command registry capture, notice capture, and workspace leaf controls.
  - Harness exposes helpers to set active editor selection and inspect view activation/detach behavior.

### Phase B: Unit and Integration Coverage

- [x] **B1** — Service-level unit tests execute against typed fakes
  - Service tests validate key behavior paths (disposed guards, happy path outputs, and dependency invocation contracts) without source-string assertions.
  - Unit tests remain independent of plugin lifecycle wiring and run purely in Node environment.

- [x] **B2** — Plugin lifecycle integration tests execute with Obsidian-compatible mocks
  - Integration tests instantiate plugin runtime and verify `onload()`/`onunload()` side effects (view registration, command registration, runtime disposal).
  - Integration tests assert notice behavior and command callback outcomes for reindex/index-changes/search-selection paths.

- [x] **B3** — Failure-path integration coverage exists for command/runtime errors
  - At least one test simulates command failure and verifies normalized failure handling flow (notice + progress/status behavior).
  - At least one test simulates no-selection path for semantic search command and confirms early-return notice behavior.

### Phase C: Test Suite Structure and Maintainability

- [x] **C1** — Test layout separates smoke, unit, and integration concerns
  - `smoke`, `unit`, and `integration` responsibilities are explicit by file location/name and avoid duplicated harness boilerplate.
  - New stories can add tests by composing harness helpers instead of recreating raw Obsidian stubs.

- [x] **C2** — Existing baseline smoke intent is preserved
  - Compile-safe domain contract checks remain in place where still valuable.
  - Any removed source-string assertion is replaced by executable runtime assertion in unit/integration tests.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Mock layer can diverge from real Obsidian behavior and create false confidence | Keep mocks minimal and constrained to currently used APIs; document unsupported surfaces and extend only when needed |
| 2 | Overly permissive mocks can hide regressions | Use strict defaults and explicit assertions around command/view/notice interactions |
| 3 | Integration tests may become brittle if they assert internal implementation details | Assert observable behavior (registered commands, notice text, lifecycle outcomes) instead of private method internals |
| 4 | Expanded test scope can slow CI/local runs | Keep harness lightweight, isolate heavy setup in factories, and avoid unnecessary deep integration scenarios in this story |

---

## Implementation Order

1. `src/__tests__/setup/mockObsidianModule.ts` — implement deterministic global `obsidian` mock primitives and state reset helpers (covers A1).
2. `src/__tests__/harness/createMockAppHarness.ts` — add reusable app/workspace/leaf/notice/command harness factory with typed helpers (covers A2, C1).
3. `src/__tests__/harness/createPluginTestHarness.ts` — compose plugin lifecycle helpers around app harness and command invocation utilities (covers B2, C1).
4. `vitest.config.ts` — register setup file and enforce stable test runtime config for all suites (covers A1, C1).
5. `src/__tests__/unit/services.runtime.test.ts` — add service unit tests for disposal guards and dependency invocation contracts (covers B1).
6. `src/__tests__/integration/plugin.runtime.test.ts` — add executable plugin lifecycle and command-path tests, including no-selection and failure flows (covers B2, B3).
7. `src/__tests__/smoke.test.ts` — trim/rebalance smoke assertions so remaining checks complement (not duplicate) unit/integration coverage (covers C2).
8. **Verify** — run `npm run test`, `npm run typecheck`, and `npm run lint` to confirm harness stability and type-safe mocks (covers Z2, Z3).
9. **Final verify** — run `npm run build` and confirm no production behavior changes outside test/config files (covers Z1, Z4).

---

*Created: 2026-02-21 | Story: FND-6 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
