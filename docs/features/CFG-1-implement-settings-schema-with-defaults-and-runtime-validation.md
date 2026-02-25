# CFG-1: Implement settings schema with defaults and runtime validation

**Story**: Introduce a centralized settings schema that applies defaults and validates persisted/runtime values so invalid settings never break provider, indexing, or chat flows.
**Epic**: Epic 6 — Settings, Secrets, and Configuration Guardrails
**Size**: Medium
**Status**: Done

---

## 1. Summary

CFG-1 delivers a dedicated settings normalization layer that validates provider IDs, model names, endpoint strings, folder lists, and numeric guardrails (`maxGeneratedNoteSize`, `chatTimeout`) before runtime services consume them. This prevents malformed persisted data from creating undefined provider lookups or invalid timeout behavior.

The story also routes plugin load/save through schema normalization so both startup and user-initiated settings changes go through the same validation path. That keeps behavior deterministic across sessions and protects existing indexing/search/chat logic from malformed persisted values.

This work unblocks CFG-2 through CFG-6 by providing a stable contract for UI input, secret integration, model/provider selection, timeout controls, and versioned migrations.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin; there is no REST contract change. Type/schema updates are internal and implemented in `src/settingsSchema.ts` and `src/main.ts`.

```ts
export const SETTINGS_SCHEMA_VERSION = 1;

export const normalizeSettingsSnapshot = (
  input: Partial<ObsidianAISettings> | null | undefined,
  defaults: ObsidianAISettings
): ObsidianAISettings => {
  // Runtime-safe coercion for providers, models, endpoints, folders, and numeric limits.
};
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Plugin.loadSettings()
└── settingsSchema.migratePersistedSettings()
    └── settingsSchema.normalizeSettingsSnapshot()
        └── runtime services consume validated settings

Settings UI save
└── Plugin.saveSettings()
    └── settingsSchema.normalizeSettingsSnapshot()
        └── persist normalized settings envelope
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `normalizeSettingsSnapshot` | `(input, defaults) => ObsidianAISettings` | Stateless/pure | Central runtime validation/coercion path |
| `migratePersistedSettings` | `(input: unknown) => PersistedSettingsData` | Stateless/pure | Converts legacy persisted shapes to current schema |
| `serializeSettingsForPersistence` | `(settings) => settings + version` | Stateless/pure | Ensures persisted payload includes schema version |
| `ObsidianAIPlugin.loadSettings` | `() => Promise<void>` | Plugin settings state | Reads legacy or envelope settings and normalizes |
| `ObsidianAIPlugin.saveSettings` | `() => Promise<void>` | Plugin settings state | Re-normalizes and persists versioned settings |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Plugin startup loads persisted settings and applies migration + normalization |
| Error | Invalid types are coerced/fallback to defaults instead of surfacing runtime crashes |
| Empty | Missing settings payload resolves to defaults |
| Success | Runtime always receives validated `ObsidianAISettings` snapshot |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/settingsSchema.ts` | Implement schema versioning primitives, migration, normalization, and persistence serialization |
| 2 | `src/__tests__/unit/settingsSchema.test.ts` | Verify normalization defaults and legacy migration behavior |
| 3 | `src/__tests__/integration/plugin.settings.test.ts` | Verify plugin load/save uses migration + normalized persistence envelope |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Route load/save through settings migration/normalization and versioned envelope key |
| 2 | `src/settings.ts` | Ensure UI edits flow through save path backed by runtime validation |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/SearchService.ts` — search ranking behavior is unchanged
- `src/services/ChatService.ts` — chat orchestration remains unchanged
- `src/providers/*` — provider API request semantics are unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Schema + Validation

- [x] **A1** — Central settings schema module validates runtime values with defaults
  - Invalid provider IDs fall back to known providers.
  - Empty model/endpoint/numeric settings are normalized to safe defaults.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::normalizes_invalid_and_empty_values_using_defaults(vitest)`

- [x] **A2** — Folder scope settings are normalized and deduplicated
  - Folder list parsing supports string and array forms from persisted settings.
  - Duplicate entries are removed deterministically.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::normalizes_invalid_and_empty_values_using_defaults(vitest)`

### Phase B: Runtime Wiring

- [x] **B1** — Plugin load path applies migration + normalization before runtime bootstrap
  - Legacy/unversioned persisted settings are accepted and coerced safely.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::loads_legacy_top_level_settings_and_applies_migration_defaults(vitest)`

- [x] **B2** — Plugin save path persists normalized settings without corrupting non-settings data
  - Existing root keys (index state) remain intact after saving settings.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::saves_settings_into_versioned_envelope_without_dropping_index_state(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/settingsSchema.ts::typed_runtime_coercion(eslint+review)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable for this plugin-only story; no shared client imports were added.
  - Evidence: `src/**/*.ts::no_shared_client_import_changes(code_review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Coercing invalid values to defaults can mask user mistakes | Keep settings UI clear; preserve deterministic defaults to avoid runtime crashes |
| 2 | Schema changes can diverge from settings UI quickly | Keep normalization centralized in `settingsSchema.ts` and reuse from load/save |
| 3 | Persisted root shape changes may break older data | Maintain legacy fallback in load path and explicit migration support |

---

## Implementation Order

1. `src/settingsSchema.ts` — implement migration, normalization, and versioned serialization helpers (covers A1, A2).
2. `src/main.ts` — wire load/save to schema helpers and preserve other persisted root keys (covers B1, B2).
3. `src/__tests__/unit/settingsSchema.test.ts` — validate coercion, migration, and version serialization (covers A1, A2).
4. `src/__tests__/integration/plugin.settings.test.ts` — validate load/save integration behavior (covers B1, B2).
5. **Verify** — run targeted settings tests via `npm run test -- src/__tests__/unit/settingsSchema.test.ts src/__tests__/integration/plugin.settings.test.ts`.
6. **Final verify** — run `npm run build` and `npm run lint`.

---

*Created: 2026-02-24 | Story: CFG-1 | Epic: Epic 6 — Settings, Secrets, and Configuration Guardrails*
