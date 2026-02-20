# FND-2: Register plugin lifecycle, views, commands, and settings tab shell

**Story**: Implement the runtime shell registrations so the plugin can load cleanly in Obsidian with placeholder views, commands, and settings wiring.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story builds directly on the FND-1 scaffold by wiring the plugin lifecycle entrypoints to register runtime surfaces: search and chat views, baseline commands, a progress slideout shell, and a settings tab shell. The outcome is a navigable plugin skeleton that Obsidian can load, display, and unload safely.

FND-2 is the integration seam between "project scaffolding exists" and "feature logic can be implemented." Downstream stories in indexing, search, chat, and settings rely on stable view IDs, command IDs, and registration behavior being in place first. Completing this story prevents repeated bootstrap changes later.

The key constraint is startup minimalism and deterministic lifecycle behavior. `onload()` should register components only; it must not perform expensive initialization such as indexing jobs, provider calls, or database setup. `onunload()` must clean up leaves/resources predictably to avoid stale UI state.

---

## 2. API Endpoints + Schemas

No API endpoint or shared schema changes are needed for this story.

FND-2 is lifecycle and UI shell registration inside an Obsidian plugin process. It does not add or modify REST routes, and it does not require NEW or CHANGED interfaces in `shared/types.ts`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAIPlugin (src/main.ts)
├── onload()
│   ├── registerView(SEARCH_VIEW_TYPE, SearchView)
│   ├── registerView(CHAT_VIEW_TYPE, ChatView)
│   ├── registerCommand("obsidian-ai:reindex-vault")
│   ├── registerCommand("obsidian-ai:index-changes")
│   ├── registerCommand("obsidian-ai:search-selection")
│   ├── addSettingTab(new ObsidianAISettingTab(...))
│   └── initialize ProgressSlideout shell (idle only)
└── onunload()
    ├── detach leaves for registered view types
    └── dispose shell references/resources
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ObsidianAIPlugin.onload` | `async onload(): Promise<void>` | Internal refs for views/settings/shells | Registration-only startup behavior |
| `ObsidianAIPlugin.onunload` | `async onunload(): Promise<void>` | Tracks cleanup/disposal path | Must detach view leaves and release resources |
| `SearchView` | `class SearchView extends ItemView` | Placeholder view state | Shell content only; no search execution logic |
| `ChatView` | `class ChatView extends ItemView` | Placeholder view state | Shell content only; no provider streaming logic |
| `ProgressSlideout` | Shell class API (`show`, `hide`, `setStatus`/equivalent) | Hidden by default | Prepares integration point for later indexing job updates |
| `ObsidianAISettingTab` | `class ... extends PluginSettingTab` | Default settings shell state | Renders placeholders and basic save/load path |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Plugin enable path runs registration logic quickly, without heavy startup work |
| Error   | Registration failure surfaces as plugin load error; no partial registration leftovers |
| Empty   | Views/commands/settings are visible but intentionally placeholder-only in this story |
| Success | Plugin loads, both panes can open, commands appear, and settings tab renders shell controls |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/constants.ts` | Centralize stable IDs for view types and commands |
| 2 | `src/ui/SearchView.ts` | Implement semantic search pane shell (`ItemView`) |
| 3 | `src/ui/ChatView.ts` | Implement chat pane shell (`ItemView`) |
| 4 | `src/ui/ProgressSlideout.ts` | Implement progress slideout shell interface and placeholder rendering |
| 5 | `src/settings.ts` | Implement plugin settings tab shell and default settings wiring |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Register views/commands/settings and implement unload cleanup |
| 2 | `src/types.ts` | Add shell-level types for view IDs, command IDs, or settings shape as needed |
| 3 | `src/__tests__/smoke.test.ts` | Expand smoke coverage for importability/registration surface sanity |

### Files UNCHANGED (confirm no modifications needed)

- `manifest.json` — plugin metadata remains valid from FND-1
- `versions.json` — compatibility mapping unchanged by runtime shell registration
- `docs/prompts/initial.md` — requirements source remains unchanged
- `docs/features/FND-1-initialize-obsidian-plugin-scaffold-and-build-pipeline.md` — previous story plan remains unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Registration Constants and Lifecycle Wiring

- [x] **A1** — Shared IDs exist for all registered runtime surfaces
  - Constants are defined for search/chat view types and the three MVP command IDs.
  - `src/main.ts` consumes constants rather than hardcoded string literals.

- [x] **A2** — `onload()` registers shell surfaces without heavy initialization
  - Search and chat views are registered and can be activated by type.
  - Commands and settings tab are registered, with no indexing/provider/database work executed in `onload()`.

- [x] **A3** — `onunload()` performs deterministic cleanup
  - Leaves for registered view types are detached (or otherwise safely closed).
  - Shell resources are disposed without uncaught runtime exceptions.

### Phase B: View, Slideout, and Settings Shells

- [x] **B1** — Search and chat shells implement valid `ItemView` contracts
  - Each view implements required methods (`getViewType`, `getDisplayText`, `onOpen`, `onClose`).
  - Opening each view shows clear placeholder content indicating "shell only."

- [x] **B2** — Progress slideout shell is wired for later job integration
  - A minimal slideout API exists (show/hide/status update methods; exact naming documented).
  - No indexing progress producer is wired in this story.

- [x] **B3** — Settings tab shell renders and persists defaults
  - A `PluginSettingTab` subclass is registered and visible.
  - Default settings save/load path works without storing secrets in plain config.

### Phase C: Command Shell Behavior

- [x] **C1** — MVP command set is present in command palette
  - `Reindex vault`, `Index changes`, and `Semantic search selection` commands are registered.
  - Command IDs match naming conventions documented in `README.md`.

- [x] **C2** — Command callbacks are safe placeholders
  - Callbacks execute without crashes and return explicit "not implemented in FND-2" feedback.
  - Selection-based command handles empty selection gracefully.

- [x] **C3** — View activation helper behavior avoids duplicate leaf spam
  - Command/view helper path reuses or reveals an existing pane when possible.
  - Opening/closing behavior remains stable across repeated invocations.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Registration logic can unintentionally grow into startup work that hurts load time | Enforce explicit "registration-only" scope in lifecycle methods |
| 2 | Inconsistent IDs across files can break command/view integration in later stories | Centralize IDs in `src/constants.ts` and reuse them everywhere |
| 3 | Incomplete unload cleanup can leave stale leaves and brittle plugin reload behavior | Add explicit cleanup helpers and verify enable/disable cycle in Obsidian |
| 4 | `Z4` may be not-applicable before client/shared split exists | Retain gate for template consistency and mark applicability during implementation verification |

---

## Implementation Order

1. `src/constants.ts` and `src/types.ts` — define stable command/view identifiers and shell-level types (covers A1).
2. `src/ui/SearchView.ts` and `src/ui/ChatView.ts` — implement minimal `ItemView` shells with placeholder rendering (covers B1).
3. `src/ui/ProgressSlideout.ts` — add slideout shell API and placeholder behavior (covers B2).
4. `src/settings.ts` — implement settings tab shell and default settings save/load wiring (covers B3).
5. `src/main.ts` — register all views/commands/settings in `onload()` and cleanup in `onunload()` (covers A2, A3, C1, C2, C3).
6. `src/__tests__/smoke.test.ts` — extend smoke checks for shell-level surfaces and importability (covers A1, C1).
7. **Verify** — run `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run test` (covers Z1, Z2, Z3).
8. **Verify in Obsidian** — enable plugin in a test vault, open both panes, run all three commands, open settings, disable plugin, and re-enable to confirm cleanup path stability (covers B1, B3, C1, C2, A3).
9. **Final verify** — confirm no out-of-scope edits and no heavy startup side effects were introduced (covers A2 and Phase Z).

---

*Created: 2026-02-20 | Story: FND-2 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
