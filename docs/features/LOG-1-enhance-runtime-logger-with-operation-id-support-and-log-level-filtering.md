# LOG-1: Enhance runtime logger with operation ID support and log-level filtering

**Story**: Upgrade runtime logging to support operation-scoped IDs, level filtering, and ergonomic helper methods so instrumentation can be added consistently across the codebase.
**Epic**: Epic 9 — Logging and Observability Instrumentation
**Size**: Small
**Status**: Done

---

## 1. Summary

LOG-1 establishes the shared logging foundation for Epic 9. It upgrades the runtime logger from a minimal `log()` emitter into a structured logger that can produce operation-correlated events and enforce a global log-level threshold.

Downstream stories (LOG-2 through LOG-6) depend on these logger capabilities to avoid duplicated instrumentation logic and to keep event volume configurable. Without this baseline, service and UI instrumentation would either be inconsistent or too noisy.

The key design constraint is backward compatibility: existing `logger.log({...})` call sites should continue to work while new convenience APIs (`debug/info/warn/error`) and operation ID helpers become available immediately.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

Shared TypeScript contracts are extended:

```ts
export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeLogEvent {
  level: RuntimeLogLevel;
  event: string;
  message: string;
  operationId?: string;
}

export interface RuntimeLoggerContract {
  log(event: RuntimeLogEvent): void;
  debug(event: Omit<RuntimeLogEvent, "level">): void;
  info(event: Omit<RuntimeLogEvent, "level">): void;
  warn(event: Omit<RuntimeLogEvent, "level">): void;
  error(event: Omit<RuntimeLogEvent, "level">): void;
  withOperation(operationId?: string): RuntimeLoggerContract;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Settings (logLevel)
└── normalizeSettingsSnapshot()
    └── setRuntimeLogLevel()
        └── createRuntimeLogger(scope)
            ├── logger.log(event)
            ├── logger.info/warn/error/debug(event)
            └── logger.withOperation(operationId)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `createRuntimeLogger` | `(scope: string) => RuntimeLoggerContract` | Module-level log level | Primary logging factory |
| `setRuntimeLogLevel` | `(level: RuntimeLogLevel) => void` | Global threshold | Updated when settings load/save |
| `ObsidianAISettings.logLevel` | `"debug" \| "info" \| "warn" \| "error"` | Persisted plugin setting | Controls log emission threshold |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not applicable; this story adds infrastructure and tests. |
| Error | Invalid log level input falls back to default level in normalization. |
| Empty | Not applicable. |
| Success | Logs emit only at/above threshold and include operation IDs where provided. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/LOG-1-enhance-runtime-logger-with-operation-id-support-and-log-level-filtering.md` | Story spec and acceptance criteria |
| 2 | `src/__tests__/unit/runtimeLogger.test.ts` | Runtime logger operation ID + level filtering tests |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/logging/runtimeLogger.ts` | Add level threshold, operation IDs, helper methods, and child-operation logger |
| 2 | `src/types.ts` | Extend logger and settings contracts with `logLevel` and helper APIs |
| 3 | `src/settings.ts` | Add default `logLevel` and wire runtime logger level updates from settings |
| 4 | `src/settingsSchema.ts` | Normalize and persist `logLevel` with safe fallback behavior |
| 5 | `src/__tests__/unit/settingsSchema.test.ts` | Verify `logLevel` normalization and persistence behavior |
| 6 | `README.md` | Link LOG-1 story in Epic 9 backlog table |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — instrumentation is deferred to LOG-2.
- `src/services/ChatService.ts` — instrumentation is deferred to LOG-3.

---

## 5. Acceptance Criteria Checklist

### Phase A: Runtime Logger Foundation

- [x] **A1** — Runtime logger supports operation IDs for correlated events
  - Logger factory can derive child loggers bound to a generated or caller-provided `operationId`.
  - Emitted payload includes `operationId` when present.
  - Evidence: `src/__tests__/unit/runtimeLogger.test.ts::A1_with_operation_id_scopes_logs(vitest)`

- [x] **A2** — Runtime logger enforces log-level threshold and exposes convenience methods
  - `debug/info/warn/error` helper methods map to `log()` and honor threshold filtering.
  - Lower-priority logs are suppressed when global threshold is higher.
  - Evidence: `src/__tests__/unit/runtimeLogger.test.ts::A2_log_level_threshold_filters_events(vitest)`

- [x] **A3** — Settings model supports `logLevel` with normalization and persistence
  - `ObsidianAISettings` includes `logLevel`.
  - Defaults, schema normalization, and serialization include `logLevel`.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::A3_log_level_normalization_and_persistence(vitest)`

### Phase B: Compatibility and Safety

- [x] **B1** — Existing `logger.log({...})` call sites remain compatible
  - No runtime code changes are required at existing call sites to preserve behavior.
  - Evidence: `src/logging/runtimeLogger.ts::B1_backward_compatible_log_api(vitest)`

- [x] **B2** — Plugin applies log-level setting to runtime logger on load/save
  - Logger threshold is synchronized after settings load and after settings save.
  - Evidence: `src/settings.ts::B2_apply_runtime_log_level(runtime-check)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/unit/runtimeLogger.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope does not add shared-client imports.
  - Evidence: `src/logging/runtimeLogger.ts::Z4_import_path_consistency(eslint)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Logging utility itself provides structured level-aware emission for all downstream stories.
  - Evidence: `src/logging/runtimeLogger.ts::Z5_structured_logger_foundation(code-review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Global logger threshold could hide diagnostics unexpectedly | Use conservative default (`info`) and explicit setting in UI (LOG-6) |
| 2 | Expanded logger contract could break compile-time consumers | Keep `log(event)` unchanged and add methods incrementally |
| 3 | Operation IDs could be inconsistently applied | Provide `withOperation()` helper to standardize usage |

---

## Implementation Order

1. `src/types.ts` — extend settings and logger contracts (`logLevel`, helper logger methods) (covers A1, A2, A3).
2. `src/logging/runtimeLogger.ts` — implement threshold filtering, operation scoping, and helper methods (covers A1, A2, B1).
3. `src/settingsSchema.ts` and `src/settings.ts` — normalize/persist/apply `logLevel` (covers A3, B2).
4. `src/__tests__/unit/runtimeLogger.test.ts` and `src/__tests__/unit/settingsSchema.test.ts` — add/extend coverage for operation IDs + level filtering + settings behavior (covers A1, A2, A3).
5. **Verify** — run targeted tests for logger/settings.
6. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-26 | Story: LOG-1 | Epic: Epic 9 — Logging and Observability Instrumentation*
