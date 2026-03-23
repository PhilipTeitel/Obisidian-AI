# INTG-4: Add token budget settings to plugin settings UI

**Story**: Add four token-budget settings (`summaryMaxTokens`, `matchedContentBudget`, `siblingContextBudget`, `parentSummaryBudget`) to the plugin settings schema, defaults, and settings tab UI so that users can tune hierarchical indexing and retrieval budgets without code changes.
**Epic**: Epic 15 — Hierarchical Indexing Pipeline Integration
**Size**: Small
**Status**: Complete

---

## 1. Summary

This story adds four new numeric settings to the `ObsidianAISettings` interface and the settings tab UI. These settings control token budgets used by `SummaryService` (summary generation) and `ContextAssemblyService` (three-phase retrieval context assembly). Currently, both services use hardcoded constants with runtime fallbacks: `SummaryService` uses `SUMMARY_MAX_TOKENS_DEFAULT = 100`, and `ContextAssemblyService` reads the three budget fields from settings via an unsafe `Record<string, unknown>` cast with fallback defaults (`DEFAULT_MATCHED_CONTENT_BUDGET = 2000`, `DEFAULT_SIBLING_CONTEXT_BUDGET = 1000`, `DEFAULT_PARENT_SUMMARY_BUDGET = 1000`).

After this story, the four fields will be first-class members of `ObsidianAISettings` with typed defaults in `DEFAULT_SETTINGS`. The settings tab will include a new "Hierarchical Indexing" section with four number inputs. `ContextAssemblyService.resolveBudgets()` can be simplified to read directly from the typed settings instead of using the `Record<string, unknown>` cast. `SummaryService` can read `summaryMaxTokens` from settings instead of its hardcoded constant.

This story has no dependencies on other INTG stories and can be implemented in parallel with INTG-1 through INTG-3. It is a pure settings/UI change with no service logic modifications beyond removing the unsafe cast in `ContextAssemblyService` and wiring `SummaryService` to read from settings.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The `ObsidianAISettings` interface in `src/types.ts` gains four new fields:

```ts
export interface ObsidianAISettings {
  // ... existing fields ...
  summaryMaxTokens: number;
  matchedContentBudget: number;
  siblingContextBudget: number;
  parentSummaryBudget: number;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
src/settings.ts (modified)
├── DEFAULT_SETTINGS — add four new defaults
└── ObsidianAISettingTab.display()
    └── New "Hierarchical Indexing" section
        ├── "Summary max tokens" — number input → summaryMaxTokens
        ├── "Matched content budget" — number input → matchedContentBudget
        ├── "Sibling context budget" — number input → siblingContextBudget
        └── "Parent summary budget" — number input → parentSummaryBudget
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAISettingTab.display()` | N/A (reads `this.plugin.settings`) | Four new `Setting` controls | Each uses `addText` with `parseInt` validation, same pattern as `maxGeneratedNoteSize` and `chatTimeout` |
| `DEFAULT_SETTINGS` | N/A | N/A | `summaryMaxTokens: 100`, `matchedContentBudget: 2000`, `siblingContextBudget: 1000`, `parentSummaryBudget: 1000` |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | N/A — settings tab renders synchronously from in-memory settings |
| Error   | Invalid (non-positive, non-numeric) input is silently ignored; the setting retains its previous value (same pattern as existing number settings) |
| Empty   | Default values are used from `DEFAULT_SETTINGS` when the plugin loads for the first time or when the field is missing from persisted data |
| Success | Value is saved immediately on change via `this.plugin.saveSettings()` |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/settings.tokenBudgets.test.ts` | Unit tests verifying the four new fields exist in `DEFAULT_SETTINGS` with correct values, that `ObsidianAISettings` includes the fields (compile-time), and that the settings tab renders the new controls |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add `summaryMaxTokens`, `matchedContentBudget`, `siblingContextBudget`, `parentSummaryBudget` to `ObsidianAISettings` interface |
| 2 | `src/settings.ts` | Add four defaults to `DEFAULT_SETTINGS`; add "Hierarchical Indexing" section with four number inputs to `ObsidianAISettingTab.display()` |
| 3 | `src/services/ContextAssemblyService.ts` | Simplify `resolveBudgets()` to read typed fields directly from `ObsidianAISettings` instead of using `Record<string, unknown>` cast with fallbacks |
| 4 | `src/services/SummaryService.ts` | Read `summaryMaxTokens` from `getSettings()` instead of using the hardcoded `SUMMARY_MAX_TOKENS_DEFAULT` constant (retain constant as fallback for safety) |

### Files UNCHANGED (confirm no modifications needed)

- `src/main.ts` — no command or lifecycle changes
- `src/constants.ts` — no new constants needed
- `src/bootstrap/bootstrapRuntimeServices.ts` — services already receive `getSettings`; no wiring changes
- `src/utils/tokenEstimator.ts` — token estimation logic is unchanged
- `src/storage/SqliteVecRepository.ts` — storage layer does not consume these settings
- `src/services/SearchService.ts` — retrieval phases 1 and 2 do not use token budgets
- `src/services/IndexingService.ts` — indexing orchestration does not consume these settings directly

---

## 5. Acceptance Criteria Checklist

### Phase A: Settings Schema

- [x] **A1** — `ObsidianAISettings` includes `summaryMaxTokens: number`
  - The `ObsidianAISettings` interface in `src/types.ts` declares `summaryMaxTokens` as a required `number` field.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::A1_summaryMaxTokens_in_interface(vitest)`

- [x] **A2** — `ObsidianAISettings` includes `matchedContentBudget: number`
  - The `ObsidianAISettings` interface in `src/types.ts` declares `matchedContentBudget` as a required `number` field.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::A2_matchedContentBudget_in_interface(vitest)`

- [x] **A3** — `ObsidianAISettings` includes `siblingContextBudget: number`
  - The `ObsidianAISettings` interface in `src/types.ts` declares `siblingContextBudget` as a required `number` field.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::A3_siblingContextBudget_in_interface(vitest)`

- [x] **A4** — `ObsidianAISettings` includes `parentSummaryBudget: number`
  - The `ObsidianAISettings` interface in `src/types.ts` declares `parentSummaryBudget` as a required `number` field.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::A4_parentSummaryBudget_in_interface(vitest)`

### Phase B: Default Values

- [x] **B1** — `DEFAULT_SETTINGS.summaryMaxTokens` equals `100`
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::B1_default_summaryMaxTokens(vitest)`

- [x] **B2** — `DEFAULT_SETTINGS.matchedContentBudget` equals `2000`
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::B2_default_matchedContentBudget(vitest)`

- [x] **B3** — `DEFAULT_SETTINGS.siblingContextBudget` equals `1000`
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::B3_default_siblingContextBudget(vitest)`

- [x] **B4** — `DEFAULT_SETTINGS.parentSummaryBudget` equals `1000`
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::B4_default_parentSummaryBudget(vitest)`

### Phase C: Settings Tab UI

- [x] **C1** — Settings tab renders a "Hierarchical Indexing" section heading
  - The `display()` method creates an `h3` element with text "Hierarchical Indexing" before the four new settings.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::C1_hierarchical_indexing_heading(vitest)`

- [x] **C2** — "Summary max tokens" setting renders with correct default and saves valid positive integers
  - The setting displays the current `summaryMaxTokens` value, accepts positive integer input, and calls `saveSettings()` on change. Non-positive or non-numeric input is ignored.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::C2_summary_max_tokens_control(vitest)`

- [x] **C3** — "Matched content budget" setting renders with correct default and saves valid positive integers
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::C3_matched_content_budget_control(vitest)`

- [x] **C4** — "Sibling context budget" setting renders with correct default and saves valid positive integers
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::C4_sibling_context_budget_control(vitest)`

- [x] **C5** — "Parent summary budget" setting renders with correct default and saves valid positive integers
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::C5_parent_summary_budget_control(vitest)`

### Phase D: Service Integration

- [x] **D1** — `ContextAssemblyService.resolveBudgets()` reads typed fields directly without `Record<string, unknown>` cast
  - The `resolveBudgets()` function accesses `settings.matchedContentBudget`, `settings.siblingContextBudget`, and `settings.parentSummaryBudget` directly from the typed `ObsidianAISettings` object. The `as Record<string, unknown>` cast is removed.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::D1_context_assembly_reads_typed_settings(vitest)`

- [x] **D2** — `SummaryService` reads `summaryMaxTokens` from settings
  - The `callLLMForSummary` method (or equivalent) reads `getSettings().summaryMaxTokens` to determine the max tokens for summary generation calls, falling back to `SUMMARY_MAX_TOKENS_DEFAULT` if the value is not a positive number.
  - Evidence: `src/__tests__/unit/settings.tokenBudgets.test.ts::D2_summary_service_reads_settings(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Adding four fields to `ObsidianAISettings` means existing users' persisted `data.json` will not have these fields on upgrade | Obsidian's `loadData()` returns partial data merged with `DEFAULT_SETTINGS` via the spread pattern in `main.ts`. Missing fields get their defaults automatically. No migration needed. |
| 2 | Removing the `Record<string, unknown>` cast in `ContextAssemblyService` creates a hard dependency on the settings fields existing | The fields are required in the interface and always present via `DEFAULT_SETTINGS`. The cast was a temporary workaround for fields that didn't exist in the type yet. |
| 3 | Users could set unreasonable budget values (e.g., 0 or extremely large) | The settings UI validates that input is a positive integer before saving, matching the existing pattern for `chatTimeout` and `maxGeneratedNoteSize`. Services retain their constant defaults as fallbacks for safety. |
| 4 | The "Hierarchical Indexing" section is visible even before the hierarchical pipeline is fully integrated | This is acceptable for MVP. The settings are consumed by services that already exist (SUM-1, RET-3). Hiding the section conditionally would add complexity for no user benefit. |

---

## Implementation Order

1. `src/types.ts` — Add `summaryMaxTokens`, `matchedContentBudget`, `siblingContextBudget`, `parentSummaryBudget` to `ObsidianAISettings` interface (covers A1–A4)
2. `src/settings.ts` — Add four defaults to `DEFAULT_SETTINGS` (covers B1–B4)
3. **Verify** — `npm run typecheck` to confirm no type errors from missing fields elsewhere
4. `src/settings.ts` — Add "Hierarchical Indexing" section with four number inputs to `ObsidianAISettingTab.display()` (covers C1–C5)
5. `src/services/ContextAssemblyService.ts` — Simplify `resolveBudgets()` to read typed fields directly, remove `Record<string, unknown>` cast (covers D1)
6. `src/services/SummaryService.ts` — Read `summaryMaxTokens` from `getSettings()` with fallback to `SUMMARY_MAX_TOKENS_DEFAULT` (covers D2)
7. **Verify** — `npm run typecheck && npm run build`
8. `src/__tests__/unit/settings.tokenBudgets.test.ts` — Write tests for all acceptance criteria A1–D2
9. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z5)

---

*Created: 2026-03-22 | Story: INTG-4 | Epic: Epic 15 — Hierarchical Indexing Pipeline Integration*
