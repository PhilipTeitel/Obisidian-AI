# REL-3: Add end-to-end tests for core user journeys

**Story**: Add end-to-end integration coverage for the primary MVP user journeys: reindex, index changes, semantic search, chat, and agent note writes.
**Epic**: Epic 7 — Performance, Reliability, and MVP Readiness
**Size**: Large
**Status**: Done

---

## 1. Summary

REL-3 closes a test-coverage gap between existing unit/service integration tests and full core workflow confidence. The project already validates individual services and commands, but there is no single end-to-end test that exercises the complete user journey chain from indexing through retrieval, chat orchestration, and agent note write actions.

This story adds a dedicated integration suite that executes these flows in sequence against the Obsidian-compatible test harness. The focus is behavioral confidence across service boundaries, including runtime lifecycle and shared state transitions between indexing/search/chat/agent operations.

The guiding principle is realistic orchestration with deterministic collaborators: use the real plugin runtime wiring and harnessed vault interactions, while keeping chat-provider streaming deterministic for stable CI execution.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required.

REL-3 introduces test/harness updates only; runtime/public contracts in `src/types.ts` remain unchanged.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
E2E integration test
└── Plugin test harness
    ├── command: Reindex vault
    ├── command: Index changes
    ├── SearchService.search()
    ├── ChatService.chat() (stream events)
    └── AgentService.createNote()/updateNote()
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `createMockAppHarness` vault adapter | markdown read + create + modify + lookup | in-memory vault state | Enables agent note write flows in integration tests |
| `coreJourneys.e2e.integration.test.ts` | journey fixture + assertions | sequential journey checkpoints | Verifies cross-service orchestration in one realistic scenario |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Commands and service calls run sequentially across lifecycle states |
| Error   | Any flow break (index/search/chat/agent) fails the integration scenario with targeted assertion context |
| Empty   | Search/chat context fallbacks remain deterministic under small fixture datasets |
| Success | Complete journey executes with expected notices/events and persisted vault write effects |

Frontend component rendering changes are not required in REL-3.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/REL-3-add-end-to-end-tests-for-core-user-journeys.md` | REL-3 planning and checklist |
| 2 | `src/__tests__/integration/coreJourneys.e2e.integration.test.ts` | End-to-end journey validation for indexing/search/chat/agent-write paths |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/__tests__/harness/createMockAppHarness.ts` | Extend mock vault adapter to support create/modify/lookup operations used by agent note-write journeys |
| 2 | `README.md` | Link REL-3 backlog row ID to story document |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/ChatService.ts` — REL-3 validates orchestration behavior without changing chat logic.
- `src/services/AgentService.ts` — REL-3 consumes existing guardrails and write behavior through integration coverage.

---

## 5. Acceptance Criteria Checklist

### Phase A: End-to-End Journey Coverage

- [x] **A1** — Add an integration scenario that runs `Reindex vault` then `Index changes` on evolving vault content
  - The scenario verifies both command paths succeed under one plugin lifecycle session.
  - Evidence: `src/__tests__/integration/coreJourneys.e2e.integration.test.ts::covers_reindex_index_changes_semantic_search_chat_and_agent_note_writes(vitest)`

- [x] **A2** — Validate semantic search returns indexed content after indexing flows
  - Search assertions confirm retrieval works after full + incremental indexing.
  - Evidence: `src/__tests__/integration/coreJourneys.e2e.integration.test.ts::covers_reindex_index_changes_semantic_search_chat_and_agent_note_writes(vitest)`

- [x] **A3** — Validate chat orchestration emits stream events in the core journey
  - Chat flow executes with deterministic stream token/done events and no runtime errors.
  - Evidence: `src/__tests__/integration/coreJourneys.e2e.integration.test.ts::covers_reindex_index_changes_semantic_search_chat_and_agent_note_writes(vitest)`

- [x] **A4** — Validate agent create/update note operations persist expected vault content
  - Integration coverage verifies both create and update note journey steps.
  - Evidence: `src/__tests__/integration/coreJourneys.e2e.integration.test.ts::covers_reindex_index_changes_semantic_search_chat_and_agent_note_writes(vitest)`

### Phase B: Harness Capability

- [x] **B1** — Mock app harness supports vault create/modify/getAbstractFileByPath for integration writes
  - Harness retains compatibility with existing tests while enabling REL-3 write-path checks.
  - Evidence: `src/__tests__/harness/createMockAppHarness.ts::B1_vault_write_adapter(harness)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/integration/coreJourneys.e2e.integration.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` package; REL-3 introduces no import changes that violate this guardrail.
  - Evidence: `src/__tests__/integration/coreJourneys.e2e.integration.test.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Full journey tests can be brittle if they depend on provider network behavior | Use deterministic mocked chat provider behavior through runtime registry override in test |
| 2 | Expanding harness behavior may affect existing integration tests | Keep adapter additive and backward compatible with current read-focused consumers |
| 3 | Large end-to-end test can be hard to debug | Use explicit step-wise assertions and focused failure messages per journey phase |

---

## Implementation Order

1. `src/__tests__/harness/createMockAppHarness.ts` — add in-memory vault create/modify/lookup helpers and file-content inspection for write assertions (covers B1).
2. `src/__tests__/integration/coreJourneys.e2e.integration.test.ts` — implement sequential journey scenario covering reindex/index changes/search/chat/agent writes (covers A1, A2, A3, A4).
3. `README.md` — link REL-3 backlog row to this story (supports tracking).
4. **Verify** — run targeted REL-3 integration suite.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: REL-3 | Epic: Epic 7 — Performance, Reliability, and MVP Readiness*
