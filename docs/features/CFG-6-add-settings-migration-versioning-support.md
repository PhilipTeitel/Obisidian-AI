# CFG-6: Add settings migration/versioning support

**Story**: Add explicit settings schema versioning and migration behavior so plugin updates preserve compatibility with legacy persisted configuration.
**Epic**: Epic 6 — Settings, Secrets, and Configuration Guardrails
**Size**: Small
**Status**: Done

---

## 1. Summary

CFG-6 introduces explicit settings schema versioning and migration primitives. Persisted settings now include `settingsVersion`, and the plugin load path migrates legacy/unversioned payloads into the current schema before runtime usage.

The persistence shape was also hardened by storing settings inside a dedicated `settings` envelope key in plugin data, while still supporting legacy top-level settings payloads during migration. This prevents key collisions with index state and future plugin data.

The core design goal is compatibility-first evolution: schema changes can be introduced incrementally without breaking existing user data.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

Internal schema and migration additions:

```ts
export const SETTINGS_SCHEMA_VERSION = 1;

export interface PersistedSettingsData extends Partial<ObsidianAISettings> {
  settingsVersion?: number;
  indexedPaths?: unknown; // legacy migration alias
  writeFolders?: unknown; // legacy migration alias
  timeoutMs?: unknown;    // legacy migration alias
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Plugin.loadSettings()
├── read plugin data root
├── resolve settings payload (envelope or legacy top-level)
├── migratePersistedSettings()
└── normalizeSettingsSnapshot()

Plugin.saveSettings()
└── persist root.settings = serializeSettingsForPersistence(...)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SETTINGS_SCHEMA_VERSION` | `number` | Static | Current schema marker for persisted settings |
| `migratePersistedSettings` | `(input: unknown) => PersistedSettingsData` | Stateless/pure | Handles legacy keys and version uplift |
| `serializeSettingsForPersistence` | `(settings) => settings+version` | Stateless/pure | Ensures persisted payload always includes version |
| `main.ts` envelope key | `settings` | Persisted data root | Prevents collisions with index manifest/job state keys |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Plugin loads versioned or legacy settings data and migrates to current schema |
| Error | Malformed legacy payloads are safely coerced to defaults |
| Empty | No prior settings resolves to defaults with current version on next save |
| Success | Settings data remains backward-compatible and future migration-ready |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/settingsSchema.ts` | Define version constant, migration flow, and persistence serialization |
| 2 | `src/__tests__/unit/settingsSchema.test.ts` | Validate legacy migration + version serialization |
| 3 | `src/__tests__/integration/plugin.settings.test.ts` | Validate envelope persistence and legacy load compatibility |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Read legacy/envelope settings and persist versioned `settings` key in root data |
| 2 | `src/settings.ts` | Ensure settings UI changes flow through new save semantics |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/indexing/IndexManifestStore.ts` — continues using independent root key
- `src/services/indexing/IndexJobStateStore.ts` — continues using independent root key

---

## 5. Acceptance Criteria Checklist

### Phase A: Schema Versioning

- [x] **A1** — Persisted settings include explicit schema version marker
  - Serialized settings payload includes `settingsVersion`.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::serializes_runtime_settings_with_schema_version(vitest)`

- [x] **A2** — Plugin persists settings under dedicated root envelope key
  - Settings write path uses `settings` key and keeps other root keys untouched.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::saves_settings_into_versioned_envelope_without_dropping_index_state(vitest)`

### Phase B: Migration Compatibility

- [x] **B1** — Legacy top-level settings payloads are migrated on load
  - Older keys (including aliases) are accepted and transformed to current shape.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::loads_legacy_top_level_settings_and_applies_migration_defaults(vitest)`

- [x] **B2** — Legacy alias fields map to current schema fields
  - `indexedPaths`, `writeFolders`, and `timeoutMs` migrate to current settings fields.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::migrates_legacy_top_level_settings_keys_to_current_shape(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/settingsSchema.ts::typed_migration_paths(eslint+review)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable for this plugin-only story; no shared client imports were added.
  - Evidence: `src/**/*.ts::no_shared_client_import_changes(code_review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Future schema versions can become brittle without migration discipline | Centralize migration logic in `settingsSchema.ts` and test legacy paths |
| 2 | Dual support for legacy and envelope payloads increases complexity | Keep extraction logic minimal and covered by integration tests |
| 3 | Root envelope changes can regress other persisted plugin data | Preserve/merge root data in save path and verify index-state retention |

---

## Implementation Order

1. `src/settingsSchema.ts` — implement version constant, alias migration, and serialization helper (covers A1, B2).
2. `src/main.ts` — add envelope read/write behavior with legacy fallback and root merge safety (covers A2, B1).
3. `src/__tests__/unit/settingsSchema.test.ts` — validate legacy alias migration and version serialization (covers A1, B2).
4. `src/__tests__/integration/plugin.settings.test.ts` — validate top-level legacy load and envelope save retention behavior (covers A2, B1).
5. **Verify** — run `npm run test -- src/__tests__/unit/settingsSchema.test.ts src/__tests__/integration/plugin.settings.test.ts`.
6. **Final verify** — run `npm run build` and `npm run lint`.

---

*Created: 2026-02-24 | Story: CFG-6 | Epic: Epic 6 — Settings, Secrets, and Configuration Guardrails*
