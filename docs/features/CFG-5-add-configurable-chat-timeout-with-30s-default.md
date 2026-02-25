# CFG-5: Add configurable chat timeout with 30s default

**Story**: Ensure chat timeout is user-configurable with a 30-second default and validated guardrails for both remote and local model providers.
**Epic**: Epic 6 — Settings, Secrets, and Configuration Guardrails
**Size**: Small
**Status**: Done

---

## 1. Summary

CFG-5 formalizes chat timeout as a validated, user-configurable setting with a default of 30000ms. This supports both lower-latency cloud APIs and slower local runtimes (for example Ollama on larger models), while keeping a safe baseline for default UX.

The timeout value is already consumed by chat orchestration; this story focuses on ensuring the setting is visible, durable, and guarded against invalid persisted values. The validation layer now enforces positive integer behavior with a minimum threshold.

This keeps chat configuration resilient across startup, settings edits, and persisted data migrations.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

No new API schemas are required. Existing `ObsidianAISettings.chatTimeout` field is validated and persisted via schema helpers.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Settings Tab
└── Chat timeout (ms) input
    └── plugin.saveSettings()
        └── normalizeSettingsSnapshot(chatTimeout guardrails)
            └── ChatPaneModel reads settings.chatTimeout
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `DEFAULT_SETTINGS.chatTimeout` | `30000` | Static | Baseline timeout |
| Settings timeout input | string -> parsed int | Plugin settings state | User-editable timeout value |
| `normalizeSettingsSnapshot` | coerces `chatTimeout` with minimum bound | Stateless/pure | Prevents invalid or too-small persisted timeout |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Timeout input displays current persisted value |
| Error | Invalid/empty timeout values are normalized to safe default |
| Empty | Empty input reverts to default timeout via normalization |
| Success | Chat requests use persisted timeout value |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/settingsSchema.test.ts` | Verify timeout fallback/normalization behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/settings.ts` | Clarify chat timeout UI copy and persistence behavior |
| 2 | `src/settingsSchema.ts` | Enforce timeout numeric guardrails with default + minimum |
| 3 | `src/main.ts` | Persist normalized timeout in settings envelope |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/ChatPaneModel.ts` — already consumes `settings.chatTimeout`
- `src/services/ChatService.ts` — provider request flow unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Timeout Configuration

- [x] **A1** — Default chat timeout remains 30000ms
  - Default settings retain 30-second timeout baseline.
  - Evidence: `src/settings.ts::default_chat_timeout_30000(code_review)`

- [x] **A2** — Settings UI exposes chat timeout control with clear guidance
  - Timeout control includes default-oriented helper text and persists on change.
  - Evidence: `src/settings.ts::chat_timeout_setting_control(code_review)`

### Phase B: Validation + Persistence

- [x] **B1** — Invalid persisted timeout values are normalized safely
  - Non-numeric/empty/too-small values fall back to defaults.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::normalizes_invalid_and_empty_values_using_defaults(vitest)`

- [x] **B2** — Persisted settings envelope stores normalized timeout values
  - Saved timeout is preserved in the versioned settings payload.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::saves_settings_into_versioned_envelope_without_dropping_index_state(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/settingsSchema.ts::typed_timeout_normalization(eslint+review)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable for this plugin-only story; no shared client imports were added.
  - Evidence: `src/**/*.ts::no_shared_client_import_changes(code_review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Very low timeout values can degrade chat reliability | Enforce minimum bound during normalization |
| 2 | Very high timeout values can delay user feedback on failures | Keep default conservative and configurable |
| 3 | Input parsing in text fields can accept transient invalid values | Normalize values at persistence boundary |

---

## Implementation Order

1. `src/settings.ts` — confirm/update chat timeout control copy and save behavior (covers A2).
2. `src/settingsSchema.ts` — enforce timeout fallback and minimum guardrail normalization (covers B1).
3. `src/main.ts` — persist normalized timeout in settings envelope (covers B2).
4. `src/__tests__/unit/settingsSchema.test.ts` — validate timeout fallback scenarios (covers B1).
5. `src/__tests__/integration/plugin.settings.test.ts` — validate persisted timeout in settings envelope (covers B2).
6. **Verify** — run `npm run test -- src/__tests__/unit/settingsSchema.test.ts src/__tests__/integration/plugin.settings.test.ts`.
7. **Final verify** — run `npm run build` and `npm run lint`.

---

*Created: 2026-02-24 | Story: CFG-5 | Epic: Epic 6 — Settings, Secrets, and Configuration Guardrails*
