# LOG-6: Add log-level setting UI and sensitive data redaction tests

**Story**: Expose runtime log-level controls in settings UI and add reusable sensitive-context redaction utilities with unit coverage.
**Epic**: Epic 9 — Logging and Observability Instrumentation
**Size**: Small
**Status**: Done

---

## 1. Summary

LOG-6 completes Epic 9 by making logging controls user-configurable and centralizing sensitive-data redaction behavior.

The story adds a `logLevel` dropdown in plugin settings so users can tune verbosity (`debug/info/warn/error`) without code changes. It also introduces a reusable `redactSensitiveContext` utility so header/context redaction logic is consistent and testable.

The guiding constraint is safety and consistency: redact once in a shared utility and test it explicitly so all logging call sites can rely on identical redaction semantics.

---

## 2. API Endpoints + Schemas

No API endpoint changes are required.

No shared schema changes are required. Existing runtime settings schema is reused and surfaced through settings UI.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Settings tab
└── "Log level" dropdown
    └── plugin.settings.logLevel
        └── plugin.saveSettings()
            └── setRuntimeLogLevel()

HTTP/provider logging
└── redactSensitiveContext()
    └── redacted context payload in log events
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAISettingTab.display` | settings form renderer | Plugin settings state | Adds `logLevel` dropdown with persisted updates |
| `redactSensitiveContext` | `(value: unknown) => unknown` | Pure utility | Redacts nested sensitive keys consistently |
| HTTP utils | request logging context | Runtime logger events | Replace ad-hoc header redaction with utility |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Settings view loads current `logLevel` value from plugin settings. |
| Error | Invalid user input is prevented by dropdown option constraints. |
| Empty | Not applicable. |
| Success | Selected `logLevel` persists and is applied on save; sensitive context tests pass. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/LOG-6-add-log-level-setting-ui-and-sensitive-data-redaction-tests.md` | Story spec and acceptance criteria |
| 2 | `src/logging/redactSensitiveContext.ts` | Shared sensitive-context redaction utility |
| 3 | `src/__tests__/unit/redactSensitiveContext.test.ts` | Unit tests for nested/key-based redaction behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/settings.ts` | Add `logLevel` dropdown to settings UI |
| 2 | `src/providers/embeddings/httpEmbeddingUtils.ts` | Use shared redaction utility for logged request context |
| 3 | `src/providers/chat/httpChatUtils.ts` | Use shared redaction utility for logged request context |
| 4 | `src/__tests__/integration/plugin.settings.test.ts` | Extend persistence assertions to include `logLevel` |
| 5 | `README.md` | Link LOG-6 story and mark done after completion |

### Files UNCHANGED (confirm no modifications needed)

- `src/settingsSchema.ts` — `logLevel` normalization already implemented in LOG-1.
- `src/logging/runtimeLogger.ts` — log-level enforcement behavior already implemented in LOG-1.

---

## 5. Acceptance Criteria Checklist

### Phase A: Log-Level Settings UI

- [x] **A1** — Settings tab exposes a `Log level` dropdown with all supported values
  - Options include `debug`, `info`, `warn`, `error`.
  - Evidence: `src/settings.ts::A1_log_level_dropdown(code-review)`

- [x] **A2** — Changing `Log level` persists via plugin save flow
  - Updated value is saved in settings payload and retained on reload.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::saves_settings_into_versioned_envelope_without_dropping_index_state(vitest)`

### Phase B: Sensitive Data Redaction Utility

- [x] **B1** — `redactSensitiveContext` utility redacts sensitive keys recursively
  - Redacts authorization/token/secret/api-key/cookie keys in nested objects and arrays.
  - Evidence: `src/__tests__/unit/redactSensitiveContext.test.ts::B1_redacts_nested_sensitive_fields(vitest)`

- [x] **B2** — HTTP logging utilities consume shared redaction utility
  - Logged header/context output never contains raw Authorization values.
  - Evidence: `src/__tests__/unit/httpEmbeddingUtils.test.ts::redacts_authorization_header_in_request_logs(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/logging/redactSensitiveContext.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope does not add shared-client imports.
  - Evidence: `src/settings.ts::Z4_import_path_consistency(eslint)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Redaction utility is integrated where sensitive request context is logged.
  - Evidence: `src/providers/embeddings/httpEmbeddingUtils.ts::Z5_redacted_context_logging(code-review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Redaction utility could over-redact useful diagnostics | Scope to sensitive key patterns while preserving non-sensitive fields |
| 2 | UI option labels may drift from runtime enum values | Reuse `RuntimeLogLevel`-compatible values directly |
| 3 | Divergent redaction behavior across files | Replace local helpers with shared utility and tests |

---

## Implementation Order

1. `src/logging/redactSensitiveContext.ts` + tests — implement recursive redaction utility and validate behavior (covers B1).
2. `src/providers/embeddings/httpEmbeddingUtils.ts` + `src/providers/chat/httpChatUtils.ts` — adopt shared utility for request context logging (covers B2).
3. `src/settings.ts` + plugin settings integration test — add `logLevel` dropdown and assert persistence (covers A1, A2).
4. **Verify** — run targeted redaction/settings tests.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-26 | Story: LOG-6 | Epic: Epic 9 — Logging and Observability Instrumentation*
