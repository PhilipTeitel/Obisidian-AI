# FND-2: Register plugin lifecycle, views, commands, and settings tab shell

**Story**: Wire the plugin runtime shell so Obsidian registers the core panes, commands, and settings entrypoints during lifecycle load/unload.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Medium
**Status**: Open

---

## 1. Summary

This story implements the runtime registration shell of the plugin by extending the FND-1 scaffold. It wires `onload()` and `onunload()` in `src/main.ts` so Obsidian can register two primary views (semantic search and chat), a progress slideout shell for long-running tasks, three MVP commands, and a plugin settings tab.

FND-2 is the structural bridge between scaffolding and feature logic. Later stories for indexing, search, and chat assume these registrations already exist, with stable view IDs, command IDs, and settings wiring. Completing this story enables downstream teams to implement actual service behavior without revisiting plugin bootstrapping.

The design constraint is strict startup minimalism: registration only, no expensive I/O, no indexing, no provider network calls, and no database initialization during `onload()`. This preserves the startup performance goal and keeps lifecycle side effects predictable.

---

## 2. API Endpoints + Schemas

No API endpoint changes are needed for this story.

FND-2 is strictly Obsidian plugin runtime wiring and UI shell registration. No REST endpoints are introduced, and no `shared/types.ts` contract updates are required.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAIPlugin (src/main.ts)
├── onload()
│   ├── registerView(SEARCH_VIEW_TYPE, SearchView)
│   ├── registerView(CHAT_VIEW_TYPE, ChatView)
│   ├── registerCommand(reindex-vault)
│   ├── registerCommand(index-changes)
│   ├── registerCommand(search-selection)
│   ├── addSettingTab(new ObsidianAISettingTab(...))
│   └── initialize ProgressSlideout shell (no long-running jobs started)
└── onunload()
    ├── detachSearchViewLeaves()
    ├── detachChatViewLeaves()
    └── dispose slideout/shell resources
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAIPlugin.onload` | `async onload(): Promise<void>` | None beyond plugin-managed references | Registers views, commands, and settings tab only |
| `ObsidianAIPlugin.onunload` | `async onunload(): Promise<void>` | Tracks registered leaves/disposables | Must cleanly detach views and avoid orphaned leaves |
| `SearchView` | `class SearchView extends ItemView` | Local empty-shell state | Renders placeholder root; no search logic yet |
| `ChatView` | `class ChatView extends ItemView` | Local empty-shell state | Renders placeholder root; no provider calls yet |
| `ProgressSlideout` | `class ProgressSlideout` shell API | Hidden/idle by default | Registration-ready shell only; no indexing progress flow yet |
| `ObsidianAISettingTab` | `class ObsidianAISettingTab extends PluginSettingTab` | Reads/saves plugin data shell | Displays section placeholders and safe defaults |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | During plugin enable, Obsidian loads plugin and executes registration logic quickly |
| Error   | Registration failure shows Obsidian plugin load error; plugin does not leave partial registrations |
| Empty   | Search/chat panes open with placeholder text; commands exist but can show "not implemented yet" notices |
| Success | Plugin enables cleanly, panes can be opened, commands are available, and settings tab renders shell controls |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/ui/SearchView.ts` | Define semantic search pane shell (`ItemView`) with stable view type wiring |
| 2 | `src/ui/ChatView.ts` | Define chat pane shell (`ItemView`) with stable view type wiring |
| 3 | `src/ui/ProgressSlideout.ts` | Define progress slideout shell class/interface used by registration flow |
| 4 | `src/settings.ts` | Define `PluginSettingTab` shell and initial settings model/default wiring |
| 5 | `src/constants.ts` | Centralize command IDs and view type IDs to avoid hardcoded strings |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Register views, commands, settings tab, and unload cleanup logic |
| 2 | `src/types.ts` | Add/adjust lightweight shell types (command/view IDs, plugin settings shape if needed) |
| 3 | `src/__tests__/smoke.test.ts` | Expand baseline test to assert registration surfaces are defined or importable |

### Files UNCHANGED (confirm no modifications needed)

- `manifest.json` — plugin metadata from FND-1 remains valid; no schema changes needed
- `versions.json` — compatibility map unchanged for runtime-shell wiring
- `docs/prompts/initial.md` — requirements source remains unchanged
- `README.md` — only the backlog ID link for FND-2 should be updated during planning; architecture text unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Lifecycle and Registration Constants

- [ ] **A1** — View and command identifiers are defined as shared constants
  - Stable IDs exist for search view, chat view, reindex command, index changes command, and semantic-search-selection command.
  - `src/main.ts` imports constants instead of hardcoded string literals.

- [ ] **A2** — `onload()` registers runtime shell components only
  - Search and chat views are registered with Obsidian via `registerView`.
  - Settings tab is registered via `addSettingTab`, and no indexing/database/provider calls are executed in `onload()`.

- [ ] **A3** — `onunload()` performs cleanup
  - Any open leaves for registered views are detached during unload.
  - Shell resources are disposed without uncaught exceptions.

### Phase B: View and Settings Shells

- [ ] **B1** — Search and chat view shells render
  - `SearchView` and `ChatView` extend `ItemView` and implement required methods (`getViewType`, `getDisplayText`, `onOpen`, `onClose`).
  - Opening each pane shows placeholder content indicating shell readiness.

- [ ] **B2** — Progress slideout shell is wired for future job updates
  - A minimal slideout class exists with explicit `show`, `hide`, and `update`-style shell methods (exact names can vary but must be documented).
  - No long-running indexing workflow is triggered in this story.

- [ ] **B3** — Settings tab shell is available
  - `PluginSettingTab` subclass renders basic sections for provider/config placeholders.
  - Save/load roundtrip for default settings works without secrets.

### Phase C: Command Shell Wiring

- [ ] **C1** — All MVP command IDs are registered
  - `Reindex vault`, `Index changes`, and `Semantic search selection` commands appear in Obsidian command palette.
  - Command IDs match backlog/API contract naming convention.

- [ ] **C2** — Command callbacks are safe placeholders
  - Callbacks run without crashing and provide explicit "not implemented in FND-2" feedback.
  - Selection command handles empty selection gracefully.

- [ ] **C3** — Pane activation commands/helpers are available
  - Plugin can open or reveal search/chat panes via helper methods invoked by future command callbacks.
  - Helper logic does not create duplicate leaves unnecessarily.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Registering too much behavior in `onload()` can violate startup performance targets | Restrict this story to registration and placeholders; defer all heavy service initialization |
| 2 | Inconsistent IDs for views/commands can break downstream integration | Centralize IDs in `src/constants.ts` and reuse across registration/tests |
| 3 | Missing unload cleanup may leave orphaned leaves or memory references | Add explicit unload detach logic and include unload path checks in testing |
| 4 | Template quality gate `Z4` references client/shared alias patterns outside this plugin-only repo | Keep for template compliance and mark as not-applicable during implementation verification |

---

## Implementation Order

1. `src/constants.ts` and `src/types.ts` — define command/view IDs and shell-level types/settings shape (covers A1).
2. `src/ui/SearchView.ts` and `src/ui/ChatView.ts` — implement `ItemView` shells with placeholder render and lifecycle methods (covers B1).
3. `src/ui/ProgressSlideout.ts` — add slideout shell API for future long-running task integration (covers B2).
4. `src/settings.ts` — create `PluginSettingTab` shell and default setting rendering/saving behavior (covers B3).
5. `src/main.ts` — wire `onload()` registrations, command callbacks, pane activation helpers, and `onunload()` cleanup (covers A2, A3, C1, C2, C3).
6. `src/__tests__/smoke.test.ts` — add or expand tests to validate imported registration surfaces and IDs (covers A1, C1).
7. **Verify** — run `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run test` (covers Z1, Z2, Z3).
8. **Verify in Obsidian** — enable plugin in a test vault, open both panes, run all three commands from command palette, open settings tab, then disable plugin to validate unload path (covers B1, B3, C1, C2, A3).
9. **Final verify** — confirm no heavy startup side effects and no files changed outside scoped runtime-shell touchpoints (covers A2 and Phase Z).

---

*Created: 2026-02-19 | Story: FND-2 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
