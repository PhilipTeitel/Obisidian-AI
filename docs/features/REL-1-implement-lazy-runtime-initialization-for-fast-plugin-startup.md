# REL-1: Implement lazy runtime initialization for fast plugin startup

**Story**: Defer heavyweight runtime service bootstrap until first runtime usage so plugin startup remains responsive.
**Epic**: Epic 7 — Performance, Reliability, and MVP Readiness
**Size**: Medium
**Status**: Done

---

## 1. Summary

REL-1 shifts plugin startup from eager runtime bootstrap to a lazy initialization strategy. Instead of constructing and initializing provider, indexing, and storage-backed services during `onload`, the plugin will register commands/views/settings immediately and only initialize runtime services when a user action requires them.

This change reduces startup work on vault open and supports the Epic 7 performance target of keeping startup practical on large vaults. It also reduces startup fragility because transient provider/storage issues are now isolated to first-use operations instead of blocking plugin load itself.

The guiding constraint is behavioral parity: command callbacks, search/chat pane workflows, and unload disposal must continue to work identically from a user perspective, with no regressions in error normalization and notice behavior.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required.

This repository does not expose HTTP routes, and REL-1 only changes internal runtime lifecycle timing in `src/main.ts`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Plugin.onload()
├── register commands / views / setting tab
├── create pane models (runtime access is deferred)
└── no runtime bootstrap yet

First runtime action (command/search/chat)
└── ensureRuntimeServices()
    ├── bootstrapRuntimeServices(...)
    └── cache RuntimeServices for reuse + dispose on unload
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAIPlugin.ensureRuntimeServices` | `() => Promise<RuntimeServices>` | caches bootstrap in-flight + resolved runtime | New lazy bootstrap gate used by command/search/chat paths |
| `SearchPaneModel.runSearch` dependency | `(request: SearchRequest) => Promise<SearchResult[]>` | async runtime lookup | Search path must continue to resolve results with existing UX |
| `ChatPaneModel.runChat` dependency | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | async generator bridge | Chat stream remains iterable while runtime is initialized lazily |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | First runtime action may include one-time bootstrap overhead before command/search/chat execution |
| Error   | Bootstrap failures are normalized and surfaced via notices/logging on the triggering action |
| Empty   | Startup itself does not force runtime creation; `runtimeServices` remains `null` until first use |
| Success | Runtime initializes once, is reused for subsequent actions, and is disposed on unload |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/REL-1-implement-lazy-runtime-initialization-for-fast-plugin-startup.md` | REL-1 planning and implementation checklist |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Replace eager bootstrap with lazy `ensureRuntimeServices()` flow; update command/search/chat runtime access and unload disposal |
| 2 | `src/__tests__/harness/createPluginTestHarness.ts` | Add helper to initialize runtime explicitly in integration tests |
| 3 | `src/__tests__/integration/plugin.runtime.test.ts` | Validate lazy bootstrap lifecycle and command failure normalization |
| 4 | `src/__tests__/integration/indexing.progress-flow.test.ts` | Initialize runtime explicitly for indexing integration flows |
| 5 | `src/__tests__/integration/searchSelectionCommand.integration.test.ts` | Support lazy runtime initialization when patching search behavior |
| 6 | `README.md` | Link REL-1 backlog row ID to this story document |

### Files UNCHANGED (confirm no modifications needed)

- `src/bootstrap/bootstrapRuntimeServices.ts` — bootstrap mechanics remain valid; only invocation timing changes.
- `src/services/ServiceContainer.ts` — lifecycle/disposal order remains unchanged.

---

## 5. Acceptance Criteria Checklist

### Phase A: Lazy Startup Lifecycle

- [x] **A1** — Plugin `onload` no longer eagerly initializes runtime services
  - Runtime shell surfaces (commands/views/settings) register successfully while `runtimeServices` remains unset until first use.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::loads_runtime_shell_surfaces_lazily_bootstraps_runtime_services_and_disposes_on_unload(vitest)`

- [x] **A2** — First runtime command initializes services on demand and executes successfully
  - Invoking a runtime-backed command after `onload` performs one-time lazy bootstrap and command completion notice flow.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::loads_runtime_shell_surfaces_lazily_bootstraps_runtime_services_and_disposes_on_unload(vitest)`

### Phase B: Runtime Access + Disposal Safety

- [x] **B1** — Search and indexing integration paths explicitly initialize runtime in lazy mode
  - Integration harness/test flows no longer assume runtime exists immediately after `onload`.
  - Evidence: `src/__tests__/integration/searchSelectionCommand.integration.test.ts::A3_selection_uses_shared_search_pipeline(vitest)`

- [x] **B2** — Lazy-initialized runtime services are disposed safely on unload
  - Services initialized via first-use path are still disposed on `onunload`.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::loads_runtime_shell_surfaces_lazily_bootstraps_runtime_services_and_disposes_on_unload(vitest)`

### Phase C: Failure Path Regression Guard

- [x] **C1** — Command failure normalization still marks progress UI as failed
  - Runtime command failures continue to emit normalized user notices and failed progress state.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::normalizes_command_failure_path_and_marks_progress_snapshot_as_failed(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/main.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` package; REL-1 introduces no import changes that violate this guardrail.
  - Evidence: `src/main.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | First command/search/chat action now pays one-time bootstrap latency | Keep lazy bootstrap deterministic and logged for observability |
| 2 | Runtime may be in-flight during unload | Preserve safe cleanup by awaiting pending bootstrap before disposal |
| 3 | Existing tests may assume eager runtime | Add explicit harness helper and update integration tests to initialize runtime intentionally |

---

## Implementation Order

1. `src/main.ts` — introduce lazy runtime gate (`ensureRuntimeServices`) and route command/search/chat runtime access through it (covers A1, A2, B2, C1).
2. `src/__tests__/harness/createPluginTestHarness.ts` — add runtime initialization helper for lazy mode integration tests (covers B1).
3. `src/__tests__/integration/plugin.runtime.test.ts` — update lifecycle/failure coverage for lazy startup behavior (covers A1, A2, B2, C1).
4. `src/__tests__/integration/indexing.progress-flow.test.ts` and `src/__tests__/integration/searchSelectionCommand.integration.test.ts` — remove eager-runtime assumptions (covers B1).
5. **Verify** — run targeted integration tests for runtime/indexing/search-selection lazy lifecycle checks.
6. **Final verify** — run `npm run lint && npm run build && npm run test`.

---

*Created: 2026-02-24 | Story: REL-1 | Epic: Epic 7 — Performance, Reliability, and MVP Readiness*
