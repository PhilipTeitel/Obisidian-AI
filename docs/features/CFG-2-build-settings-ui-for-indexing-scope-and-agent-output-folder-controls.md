# CFG-2: Build settings UI for indexing scope and agent output folder controls

**Story**: Expand the settings UI so indexing include/exclude scope and agent output folder permissions are independently configurable and persisted safely.
**Epic**: Epic 6 — Settings, Secrets, and Configuration Guardrails
**Size**: Medium
**Status**: Done

---

## 1. Summary

CFG-2 delivers the user-facing configuration controls for vault scope and write safety boundaries. The settings tab now exposes separate controls for included folders, excluded folders, and agent output folders so indexing boundaries and write permissions can be tuned independently.

This separation is important because the plugin should be able to search broadly while still limiting where the chat agent can write. The story enforces that these controls are first-class in UI and persisted through the validated settings save path.

The design constraint is to preserve a simple comma-separated interaction model while still applying normalization/guardrails via the centralized save pipeline introduced in CFG-1.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

No shared contract changes are required; this story updates plugin settings UI behavior only.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAISettingTab.display()
├── Indexed folders input
├── Excluded folders input
└── Agent output folders input
    └── plugin.saveSettings()
        └── settings schema normalization
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAISettingTab` | `display(): void` | Plugin-backed settings state | Renders and wires folder controls |
| `parseCsvList` | `(value: string) => string[]` | Stateless/pure | Parses comma-separated folder values from text controls |
| `formatCsvList` | `(values: string[]) => string` | Stateless/pure | Renders normalized folder arrays to stable text UI |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Existing settings values render into text controls |
| Error | Invalid edits are corrected by save-path normalization |
| Empty | Empty control input is allowed and normalized by defaults/schema |
| Success | Include/exclude/output scopes persist and are reloaded accurately |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/integration/plugin.settings.test.ts` | Verify scope controls persist through plugin save envelope |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/settings.ts` | Add excluded folder control and refine include/output folder control descriptions |
| 2 | `src/main.ts` | Ensure save path preserves and persists updated settings values |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/IndexingService.ts` — indexing execution logic already consumes settings snapshot
- `src/services/AgentService.ts` — output-folder enforcement logic remains unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Scope Controls

- [x] **A1** — Settings UI includes explicit indexed folder and excluded folder controls
  - Indexed and excluded scope are separately editable as comma-separated values.
  - Evidence: `src/settings.ts::indexed_and_excluded_folder_controls(code_review)`

- [x] **A2** — Agent output folders remain independently configurable from indexing scope
  - Output folder control is preserved and clearly documented as write-scope only.
  - Evidence: `src/settings.ts::agent_output_folder_control(code_review)`

### Phase B: Persistence Behavior

- [x] **B1** — Scope changes persist through plugin save path and survive reload
  - Updated settings are written into the persisted settings envelope.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::saves_settings_into_versioned_envelope_without_dropping_index_state(vitest)`

- [x] **B2** — Settings persistence does not overwrite non-settings plugin state
  - Index manifest/job state keys remain intact after settings save.
  - Evidence: `src/__tests__/integration/plugin.settings.test.ts::saves_settings_into_versioned_envelope_without_dropping_index_state(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/settings.ts::typed_settings_updates(eslint+review)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable for this plugin-only story; no shared client imports were added.
  - Evidence: `src/**/*.ts::no_shared_client_import_changes(code_review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | CSV-based folder input can be error-prone for users | Keep descriptions explicit and normalize input through save schema |
| 2 | Users may assume excluded folders affect agent writes | Keep output-scope control separate and clearly labeled |
| 3 | Frequent save calls per field edit can trigger many writes | Keep logic lightweight; rely on normalized persistence layer |

---

## Implementation Order

1. `src/settings.ts` — add excluded folders control and clarify indexing vs output scope descriptions (covers A1, A2).
2. `src/main.ts` — ensure settings saves preserve persisted root data and include updated scope fields (covers B1, B2).
3. `src/__tests__/integration/plugin.settings.test.ts` — verify settings envelope persistence with retained non-settings state (covers B1, B2).
4. **Verify** — run `npm run test -- src/__tests__/integration/plugin.settings.test.ts`.
5. **Final verify** — run `npm run build` and `npm run lint`.

---

*Created: 2026-02-24 | Story: CFG-2 | Epic: Epic 6 — Settings, Secrets, and Configuration Guardrails*
