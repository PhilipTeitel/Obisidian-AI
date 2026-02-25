# CMD-1: Add pane-open command constants and command ID type coverage

**Story**: Add stable constants and command ID union coverage for pane-open commands so registration and integration tests stay compile-safe.
**Epic**: Epic 8 — Command Palette Pane Access and Command UX
**Size**: Small
**Status**: Done

---

## 1. Summary

CMD-1 establishes the command identity primitives for opening the Semantic Search pane and Chat pane from the command palette. The goal is to define canonical IDs and display names in one place so later command registration work can consume a single source of truth.

This story is intentionally scoped to constants and typing only. CMD-2 and CMD-3 depend on this foundation to register callbacks without introducing duplicated string literals or drift between user-facing names and implementation IDs.

The guiding constraint is compile-time safety. New command IDs must be part of `ObsidianAICommandId` so command invocation utilities and tests remain type-safe when adding pane commands.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required because this story only updates internal plugin command metadata.

`src/types.ts` requires a command union expansion:

```ts
export type ObsidianAICommandId =
  | "obsidian-ai:reindex-vault"
  | "obsidian-ai:index-changes"
  | "obsidian-ai:search-selection"
  | "obsidian-ai:open-semantic-search-pane"
  | "obsidian-ai:open-chat-pane";
```

No shared API DTO additions are needed.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Command constants module
├── COMMAND_IDS
├── COMMAND_NAMES
└── consumed by plugin command registration (future CMD-2/CMD-3)

Type contracts
└── ObsidianAICommandId union
    └── consumed by test harness command invoker
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `COMMAND_IDS` | `Record<string, Obsidian command id literal>` | None | Adds pane-open ID literals |
| `COMMAND_NAMES` | `Record<string, command palette display name>` | None | Adds pane-open display names |
| `ObsidianAICommandId` | string-literal union type | None | Includes new pane-open command IDs for typed invocations |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not applicable; constants/type changes do not render UI. |
| Error | TypeScript compile errors if command constants and union drift. |
| Empty | Not applicable. |
| Success | New IDs/names are available and typed for downstream command registration. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/CMD-1-add-pane-open-command-constants-and-command-id-type-coverage.md` | Story spec and acceptance criteria for command constants/type coverage |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/constants.ts` | Add pane-open command IDs and display names |
| 2 | `src/types.ts` | Extend `ObsidianAICommandId` union with pane-open IDs |
| 3 | `src/__tests__/smoke.test.ts` | Assert new command IDs and names remain stable |

### Files UNCHANGED (confirm no modifications needed)

- `src/main.ts` — command registration behavior is deferred to CMD-2 and CMD-3.
- `README.md` — backlog row already links to this story document.

---

## 5. Acceptance Criteria Checklist

### Phase A: Command Identity Constants

- [x] **A1** — `COMMAND_IDS` includes pane-open command IDs
  - `src/constants.ts` exports `OPEN_SEMANTIC_SEARCH_PANE` and `OPEN_CHAT_PANE` IDs under `COMMAND_IDS`.
  - ID values are `obsidian-ai:open-semantic-search-pane` and `obsidian-ai:open-chat-pane`.
  - Evidence: `src/__tests__/smoke.test.ts::exposes_stable_runtime_IDs(vitest)`

- [x] **A2** — `COMMAND_NAMES` includes pane-open display names
  - `src/constants.ts` exports `Open semantic search pane` and `Open chat pane` under `COMMAND_NAMES`.
  - Display names are ready for command palette registration without additional mapping.
  - Evidence: `src/__tests__/smoke.test.ts::exposes_expected_command_display_names(vitest)`

### Phase B: Type Coverage

- [x] **B1** — `ObsidianAICommandId` union includes both new pane-open command IDs
  - `src/types.ts` accepts both pane-open IDs as legal command IDs.
  - Test harness command invocation signatures remain compile-safe with new IDs.
  - Evidence: `src/types.ts::B1_obsidian_ai_command_union(tsc)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/constants.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope has no `@shared/types` consumers; no conflicting imports introduced.
  - Evidence: `src/types.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | New command strings may drift between constants and docs | Keep IDs/names centralized in `src/constants.ts` and test for exact values |
| 2 | Missing union update could block typed command invocation in tests | Expand `ObsidianAICommandId` in same story as constants |
| 3 | Over-scoping into behavior changes increases risk | Limit CMD-1 to constants and typing only |

---

## Implementation Order

1. `src/constants.ts` — add pane-open command IDs and names (covers A1, A2).
2. `src/types.ts` — add pane-open literals to `ObsidianAICommandId` union (covers B1).
3. `src/__tests__/smoke.test.ts` — assert constant/name stability for new commands (covers A1, A2).
4. **Verify** — run targeted smoke tests for command constants.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-25 | Story: CMD-1 | Epic: Epic 8 — Command Palette Pane Access and Command UX*
