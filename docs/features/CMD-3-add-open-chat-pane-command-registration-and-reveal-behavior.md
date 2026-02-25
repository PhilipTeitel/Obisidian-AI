# CMD-3: Add `Open chat pane` command registration and reveal behavior

**Story**: Register an `Open chat pane` command that reveals an existing Chat pane when present, or opens one when missing, without sending any prompt automatically.
**Epic**: Epic 8 — Command Palette Pane Access and Command UX
**Size**: Small
**Status**: Done

---

## 1. Summary

CMD-3 provides direct command palette access for the Chat pane. Users can open or refocus chat from anywhere in Obsidian without first navigating to existing pane tabs or triggering chat completion actions.

This story follows CMD-2 and reuses the same view activation approach, now targeting `CHAT_VIEW_TYPE`. Together, CMD-2 and CMD-3 complete command-level pane access for both core plugin experiences.

The key constraint is non-execution semantics: the command only opens/reveals the pane shell. It must not invoke `ChatService`, submit prompts, or bootstrap runtime services.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No shared schema updates are required. The behavior uses existing internal contracts:

```ts
type ActivatePaneCommand = () => Promise<void>;
type ObsidianAIViewType = "obsidian-ai:search-view" | "obsidian-ai:chat-view";
```

The command callback should call shared pane activation logic to avoid introducing chat-specific view handling divergence.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Command palette
└── Open chat pane command
    └── plugin.activateView(CHAT_VIEW_TYPE)
        ├── reuse existing chat leaf when available
        ├── otherwise request right leaf
        └── reveal leaf
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `registerCommands -> OPEN_CHAT_PANE` | async callback | Command lifecycle | Registers command with stable ID/name constants |
| `activateView` | `(viewType: ObsidianAIViewType) => Promise<void>` | Workspace leaf availability | Shared open/reveal behavior across pane commands |
| `runtimeServices` | lazy bootstrap holder | Runtime init state | Must remain uninitialized when opening chat pane only |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not applicable; command performs immediate pane activation. |
| Error | User receives notice if no leaf can be opened. |
| Empty | No existing chat leaf: command creates/assigns one and reveals it. |
| Success | Existing or new chat pane is active and visible without sending a chat request. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/CMD-3-add-open-chat-pane-command-registration-and-reveal-behavior.md` | Story spec and acceptance criteria |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Register chat-pane open command callback and reuse `activateView` |
| 2 | `src/__tests__/integration/plugin.runtime.test.ts` | Assert chat-pane command registration and open/reveal behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/ChatPaneModel.ts` — no prompt execution should occur in this story.
- `src/services/ChatService.ts` — no chat request pipeline changes are needed.

---

## 5. Acceptance Criteria Checklist

### Phase A: Command Registration

- [x] **A1** — `Open chat pane` command is registered with stable ID/name constants
  - `src/main.ts` registers `COMMAND_IDS.OPEN_CHAT_PANE` with `COMMAND_NAMES.OPEN_CHAT_PANE`.
  - Integration command registry assertions include the new command ID.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::loads_runtime_shell_surfaces_lazily_bootstraps_runtime_services_and_disposes_on_unload(vitest)`

### Phase B: Reveal/Open Behavior

- [x] **B1** — Command opens and reveals Chat pane when no existing pane is present
  - Invoking the command creates/uses a leaf for `CHAT_VIEW_TYPE` and reveals it.
  - Runtime services remain lazy (no chat-completion side effects).
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::opens_chat_pane_without_bootstrapping_runtime_services(vitest)`

- [x] **B2** — Command reuses existing Chat pane leaf on repeated invocation
  - Second invocation does not create duplicate chat leaves.
  - Existing chat leaf is revealed again.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::opens_chat_pane_without_bootstrapping_runtime_services(vitest)`

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
| 1 | Command might accidentally trigger chat runtime work | Restrict callback to `activateView(CHAT_VIEW_TYPE)` |
| 2 | Repeated invocation may duplicate leaves | Keep existing-leaf reuse before requesting right leaf |
| 3 | Divergent behavior from semantic pane command could confuse users | Reuse shared activation helper for both commands |

---

## Implementation Order

1. `src/main.ts` — register `OPEN_CHAT_PANE` callback using `activateView(CHAT_VIEW_TYPE)` (covers A1, B1).
2. `src/__tests__/integration/plugin.runtime.test.ts` — extend command registration assertions and add chat-pane open/reveal/no-runtime test (covers A1, B1, B2).
3. **Verify** — run targeted plugin runtime integration tests.
4. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-25 | Story: CMD-3 | Epic: Epic 8 — Command Palette Pane Access and Command UX*
