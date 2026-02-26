# LOG-5: Instrument storage layer and AgentService with structured logging

**Story**: Add structured lifecycle logging for local vector-store operations and agent create/update note workflows.
**Epic**: Epic 9 — Logging and Observability Instrumentation
**Size**: Small
**Status**: Done

---

## 1. Summary

LOG-5 adds observability to two remaining runtime pillars: local vector-store persistence/query operations and agent-driven note creation/update flows.

The instrumentation makes it easier to diagnose storage performance/reliability issues and enforceability decisions (blocked path, missing file, size limits) in agent workflows.

The key constraint is preserving behavior while improving traceability. Logs must provide operation context and timing but should not alter existing return/throw semantics.

---

## 2. API Endpoints + Schemas

No API endpoint changes are required.

No shared schema changes are required. Existing runtime logger contracts from LOG-1 are reused.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Indexing/Search services
└── LocalVectorStoreRepository
    ├── ensureLoaded()
    ├── persist()
    └── queryNearestNeighbors()

Chat agent tools
└── AgentService
    ├── createNote()
    └── updateNote()
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `LocalVectorStoreRepository` | Repository contract methods | In-memory cache + plugin persistence | Logs load/persist/query lifecycle with timing/row counts |
| `AgentService.createNote` | `(path, content) => Promise<void>` | Guarded write workflow | Logs allow/deny path + create lifecycle |
| `AgentService.updateNote` | `(path, content) => Promise<void>` | Guarded update workflow | Logs allow/deny path + update lifecycle |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not direct UI; logs capture storage load/persist/query start/completion. |
| Error | Logs capture normalized failures and blocked workflow outcomes. |
| Empty | Empty note path arrays / empty result sets emit completion logs with zero counts. |
| Success | Create/update/query operations emit completion logs including timing metadata. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/LOG-5-instrument-storage-layer-and-agentservice-with-structured-logging.md` | Story spec and acceptance criteria |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/storage/LocalVectorStoreRepository.ts` | Add structured logging for load/persist/query/replace/upsert/delete lifecycle |
| 2 | `src/services/AgentService.ts` | Add structured logging for create/update lifecycle and blocked outcomes |
| 3 | `src/__tests__/unit/localVectorStoreRepository.test.ts` | Keep repository behavior assertions green with instrumentation |
| 4 | `src/__tests__/unit/agentService.create.test.ts` | Keep create workflow assertions green with instrumentation |
| 5 | `src/__tests__/unit/agentService.update.test.ts` | Keep update workflow assertions green with instrumentation |
| 6 | `README.md` | Link LOG-5 story and mark done after completion |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/IndexingService.ts` — orchestration behavior unchanged; storage layer emits instrumentation.
- `src/ui/ChatPaneModel.ts` — agent tool invocation semantics unchanged from prior stories.

---

## 5. Acceptance Criteria Checklist

### Phase A: Storage Layer Logging

- [x] **A1** — LocalVectorStoreRepository logs load/persist lifecycle with timing metadata
  - Includes cache hits/misses, row counts, and elapsed times for persistence.
  - Evidence: `src/storage/LocalVectorStoreRepository.ts::A1_storage_load_persist_logging(code-review)`

- [x] **A2** — LocalVectorStoreRepository logs query/upsert/replace/delete operation outcomes
  - Includes input counts, result counts, and operation elapsed timing.
  - Evidence: `src/__tests__/unit/localVectorStoreRepository.test.ts::supports_upsert_nearest_neighbor_query_and_delete_by_note_path(vitest)`

### Phase B: AgentService Logging

- [x] **B1** — AgentService createNote logs start/block/success lifecycle
  - Logs invalid path, disallowed folder, size guard, existing-file block, and success outcomes.
  - Evidence: `src/__tests__/unit/agentService.create.test.ts::A1_blocks_disallowed_paths(vitest)`

- [x] **B2** — AgentService updateNote logs start/block/success lifecycle
  - Logs invalid/disallowed/missing-file/oversize blocks and success outcomes.
  - Evidence: `src/__tests__/unit/agentService.update.test.ts::A1_blocks_invalid_or_disallowed_paths(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/storage/LocalVectorStoreRepository.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope does not add shared-client imports.
  - Evidence: `src/services/AgentService.ts::Z4_import_path_consistency(eslint)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Storage and agent significant operations include structured lifecycle logs.
  - Evidence: `src/storage/LocalVectorStoreRepository.ts::Z5_storage_agent_lifecycle_logging(code-review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Frequent storage operations can produce many logs | Keep payloads concise and rely on global log-level threshold |
| 2 | Agent path logs could expose sensitive file names | Log normalized path metadata already present in user notifications |
| 3 | Added logging in repository internals could mask core logic issues if noisy | Keep instrumentation side-effect free and preserve existing control flow |

---

## Implementation Order

1. `src/storage/LocalVectorStoreRepository.ts` — instrument load/persist/query and mutation operations with timing/context metadata (covers A1, A2).
2. `src/services/AgentService.ts` — instrument create/update lifecycle and blocked outcomes (covers B1, B2).
3. `src/__tests__/unit/localVectorStoreRepository.test.ts` + agent tests — run to verify behavior unchanged.
4. **Verify** — run targeted storage/agent tests.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-26 | Story: LOG-5 | Epic: Epic 9 — Logging and Observability Instrumentation*
