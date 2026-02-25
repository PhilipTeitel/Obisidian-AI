# CMD-5: Add integration tests for pane command discoverability and open/reveal semantics

**Story**: Add integration tests that verify pane-open commands are discoverable in the command registry and reliably open/reveal existing or missing panes.
**Epic**: Epic 8 — Command Palette Pane Access and Command UX
**Size**: Medium
**Status**: Done

---

## 1. Summary

CMD-5 hardens Epic 8 behavior with focused integration coverage for command discoverability and pane-open semantics. The goal is to ensure both pane commands remain stable as first-class command palette actions and preserve the expected open/reveal behavior over time.

Earlier stories implemented command constants and registration callbacks. This story consolidates verification into a dedicated integration suite that exercises real command registration and invocation paths through the plugin test harness.

The guiding constraint is behavioral reliability: tests must prove both creation and reuse semantics for search/chat panes and confirm that pane-open commands do not trigger runtime bootstrap side effects.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No shared schema changes are required. Existing command ID and view type constants are consumed as test fixtures:

```ts
type PaneCommandId = "obsidian-ai:open-semantic-search-pane" | "obsidian-ai:open-chat-pane";
type PaneViewType = "obsidian-ai:search-view" | "obsidian-ai:chat-view";
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Integration harness
└── plugin.onload()
    ├── command registry snapshot
    ├── invoke OPEN_SEMANTIC_SEARCH_PANE
    │   └── verify create/reuse/reveal semantics
    └── invoke OPEN_CHAT_PANE
        └── verify create/reuse/reveal semantics
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `createPluginTestHarness` | `() => PluginTestHarness` | Per-test plugin state | Drives end-to-end command registration/invocation flow |
| `invokeCommand` | `(commandId: ObsidianAICommandId) => Promise<void>` | Command execution | Uses real registered callback |
| `getLeavesForType` / `getRevealedLeaves` | Harness inspection helpers | Workspace leaf/reveal tracking | Verifies create vs reuse behavior |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not applicable; tests run synchronously through mocked harness. |
| Error | Failing assertions indicate command registration or pane semantics regression. |
| Empty | No existing pane leaf should trigger create + reveal path. |
| Success | Existing pane leaf is reused and revealed; runtime remains lazy. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/CMD-5-add-integration-tests-for-pane-command-discoverability-and-open-reveal-semantics.md` | Story spec and acceptance criteria |
| 2 | `src/__tests__/integration/paneCommands.integration.test.ts` | Focused integration coverage for pane command discoverability and open/reveal behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `README.md` | Mark CMD-5 backlog status done after test suite lands |

### Files UNCHANGED (confirm no modifications needed)

- `src/main.ts` — pane command behavior is already implemented; this story adds verification only.
- `src/constants.ts` — command IDs/names are already established.

---

## 5. Acceptance Criteria Checklist

### Phase A: Command Discoverability

- [x] **A1** — Integration tests verify pane commands are registered and discoverable
  - Registered command IDs include `OPEN_SEMANTIC_SEARCH_PANE` and `OPEN_CHAT_PANE`.
  - Discoverability assertions run via plugin onload integration harness.
  - Evidence: `src/__tests__/integration/paneCommands.integration.test.ts::A1_pane_commands_are_discoverable(vitest)`

### Phase B: Open/Reveal Semantics

- [x] **B1** — Semantic pane command creates missing pane and reuses existing pane on repeat invocation
  - First invocation opens and reveals one search pane leaf.
  - Second invocation reuses the same leaf type and reveals again without duplication.
  - Evidence: `src/__tests__/integration/paneCommands.integration.test.ts::B1_open_semantic_search_pane_create_then_reuse(vitest)`

- [x] **B2** — Chat pane command creates missing pane and reuses existing pane on repeat invocation
  - First invocation opens and reveals one chat pane leaf.
  - Second invocation reuses the same leaf type and reveals again without duplication.
  - Evidence: `src/__tests__/integration/paneCommands.integration.test.ts::B2_open_chat_pane_create_then_reuse(vitest)`

- [x] **B3** — Pane-open commands preserve lazy runtime behavior
  - Invoking pane-open commands does not bootstrap runtime services.
  - Search/chat execution is not triggered implicitly.
  - Evidence: `src/__tests__/integration/paneCommands.integration.test.ts::B3_pane_open_commands_keep_runtime_lazy(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/integration/paneCommands.integration.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope introduces no shared-client imports.
  - Evidence: `src/__tests__/integration/paneCommands.integration.test.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Existing runtime tests may overlap and create redundant coverage | Keep CMD-5 tests focused on pane discoverability and semantics only |
| 2 | Mock harness behavior may hide real workspace edge cases | Assert both create and reuse flows using real command callbacks |
| 3 | Future command renames could silently break docs/tests | Use shared constants in tests instead of hardcoded command strings |

---

## Implementation Order

1. `src/__tests__/integration/paneCommands.integration.test.ts` — add discoverability + semantic/chat open/reveal + lazy-runtime assertions (covers A1, B1, B2, B3).
2. **Verify** — run targeted integration test file.
3. **Final verify** — run `npm run lint && npm run build`.
4. `README.md` — mark CMD-5 backlog row done after verification.

---

*Created: 2026-02-25 | Story: CMD-5 | Epic: Epic 8 — Command Palette Pane Access and Command UX*
