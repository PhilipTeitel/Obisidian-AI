# CMD-2: Add `Open semantic search pane` command registration and reveal behavior

**Story**: Register an `Open semantic search pane` command that reveals an existing Semantic Search pane when present, or opens one when missing, without executing a search.
**Epic**: Epic 8 — Command Palette Pane Access and Command UX
**Size**: Small
**Status**: Done

---

## 1. Summary

CMD-2 makes the Semantic Search pane directly discoverable from the command palette through a dedicated command. Users should be able to invoke the command at any time to focus semantic search UI without needing a text selection and without starting a query.

This story depends on CMD-1 constants/type coverage and provides one half of the pane-open UX goal for Epic 8. CMD-3 mirrors this behavior for the chat pane, while CMD-5 will harden integration-level verification across both commands.

The primary constraint is behavior isolation: this command only manages pane activation and reveal. It must not bootstrap runtime services for search execution or mutate search query state.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No new shared schema interfaces are required. The story uses existing internal contracts:

```ts
type ActivatePaneCommand = () => Promise<void>;
type ObsidianAIViewType = "obsidian-ai:search-view" | "obsidian-ai:chat-view";
```

The command callback should route to existing view activation logic rather than introducing a new command-specific pane lifecycle path.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Command palette
└── Open semantic search pane command
    └── plugin.activateView(SEARCH_VIEW_TYPE)
        ├── reuse existing search leaf when available
        ├── otherwise request right leaf
        └── reveal leaf
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `registerCommands -> OPEN_SEMANTIC_SEARCH_PANE` | async callback | Command lifecycle | Registers command ID/name and callback |
| `activateView` | `(viewType: ObsidianAIViewType) => Promise<void>` | Workspace leaf availability | Reuses generic pane activation behavior |
| `runtimeServices` | lazy bootstrap holder | Runtime init state | Must remain `null` for open-pane command execution |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not applicable; command performs immediate view activation. |
| Error | User receives notice if no leaf can be opened. |
| Empty | No existing search leaf: command creates/assigns one and reveals it. |
| Success | Existing or newly created search pane is active and revealed, without running search. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/CMD-2-add-open-semantic-search-pane-command-registration-and-reveal-behavior.md` | Story spec and implementation checklist |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Register semantic-pane open command callback and reuse `activateView` |
| 2 | `src/__tests__/integration/plugin.runtime.test.ts` | Add registration and open/reveal behavior assertions for semantic-pane command |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchPaneModel.ts` — command should not trigger a search request.
- `src/services/SearchService.ts` — no query execution changes are required.

---

## 5. Acceptance Criteria Checklist

### Phase A: Command Registration

- [x] **A1** — `Open semantic search pane` command is registered with stable ID/name constants
  - `src/main.ts` registers `COMMAND_IDS.OPEN_SEMANTIC_SEARCH_PANE` with `COMMAND_NAMES.OPEN_SEMANTIC_SEARCH_PANE`.
  - Integration command registry assertions include the new command ID.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::loads_runtime_shell_surfaces_lazily_bootstraps_runtime_services_and_disposes_on_unload(vitest)`

### Phase B: Reveal/Open Behavior

- [x] **B1** — Command opens and reveals Semantic Search pane when no existing pane is present
  - Invoking the command creates/uses a leaf for `SEARCH_VIEW_TYPE` and reveals it.
  - Runtime services remain lazy (no search execution side effects).
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::opens_semantic_search_pane_without_bootstrapping_runtime_services(vitest)`

- [x] **B2** — Command reuses existing Semantic Search pane leaf on repeated invocation
  - Second invocation does not create duplicate search leaves.
  - Existing leaf is revealed again.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::opens_semantic_search_pane_without_bootstrapping_runtime_services(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/main.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope introduces no shared-client imports.
  - Evidence: `src/main.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Command could accidentally trigger search runtime execution | Restrict callback to `activateView(SEARCH_VIEW_TYPE)` only |
| 2 | Repeated command calls may create duplicate leaves | Reuse `getLeavesOfType(viewType)[0]` before requesting right leaf |
| 3 | Duplicate view activation logic may diverge over time | Reuse existing generic `activateView` helper |

---

## Implementation Order

1. `src/main.ts` — register `OPEN_SEMANTIC_SEARCH_PANE` callback using `activateView(SEARCH_VIEW_TYPE)` (covers A1, B1).
2. `src/__tests__/integration/plugin.runtime.test.ts` — extend registry expectations and add semantic-pane open/reveal/no-runtime test (covers A1, B1, B2).
3. **Verify** — run targeted plugin runtime integration tests.
4. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-25 | Story: CMD-2 | Epic: Epic 8 — Command Palette Pane Access and Command UX*
