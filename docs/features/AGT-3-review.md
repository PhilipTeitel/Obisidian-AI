REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: AGT-3 — Bounded note tools for search, note read, and draft assembly

**Reviewed against:** `docs/features/AGT-3-bounded-note-tools.md`
**Date:** 2026-04-30
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: AGT-3
- Linked refined requirements (Sn IDs in scope): REQ-007 S3, S4 (tool-substrate portion), S9
- Files in scope (from Section 7 "Files to CREATE/MODIFY" intersected with `git diff` when available):
  - `src/core/domain/agentNoteTools.ts` — created
  - `src/core/ports/IAgentNoteToolPort.ts` — created
  - `src/core/workflows/AgentNoteToolRunner.ts` — created
  - `tests/core/domain/agentNoteTools.test.ts` — created
  - `tests/contract/agent-note-tools.contract.ts` — created
  - `tests/core/workflows/AgentNoteToolRunner.test.ts` — created
  - `tests/integration/agent-note-tools.integration.test.ts` — created
  - `src/core/domain/agentRetrievalPlan.ts` — modified
  - `src/core/index.ts` — modified
  - `src/core/ports/index.ts` — modified
  - `tests/core/workflows/searchTestStore.ts` — modified
  - `vitest.config.ts` — modified
- Tests in scope (from Section 8a Test Plan):
  - `tests/core/domain/agentNoteTools.test.ts::A1_exports_tool_contract_shapes`
  - `tests/core/domain/agentNoteTools.test.ts::A2_budget_constants_not_settings`
  - `tests/contract/agent-note-tools.contract.ts::A3_port_contract_signature`
  - `tests/core/domain/agentNoteTools.test.ts::A4_rejects_unsupported_write_like_tools`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::B1_search_notes_delegates_to_search_workflow`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::B2_search_inherits_plan_scope`
  - `tests/contract/agent-note-tools.contract.ts::B3_contract_search_results_stable_and_bounded`
  - `tests/integration/agent-note-tools.integration.test.ts::B4_search_notes_uses_searchworkflow_filters_and_hybrid`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::C1_read_note_uses_document_store`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::C2_read_note_missing_target_fails_closed`
  - `tests/integration/agent-note-tools.integration.test.ts::C3_read_note_filters_and_sources_indexed_nodes`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::D1_assemble_draft_uses_prior_tool_outputs`
  - `tests/core/domain/agentNoteTools.test.ts::D2_assemble_draft_has_no_write_surface`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::D3_assemble_draft_carries_output_intent`
  - `tests/contract/agent-note-tools.contract.ts::E1_contract_trace_records_are_stable`
  - `tests/core/workflows/AgentNoteToolRunner.test.ts::E2_budget_exhaustion_fails_closed`
  - `npm run build`, `npm run lint`, `npm run typecheck`
  - `/review-story AGT-3`
- Adapters in scope (from Section 4b):
  - `AgentNoteToolRunner` for port `IAgentNoteToolPort`

If the diff includes files **not** listed in Section 7, list them under "Out-of-plan changes" below — do not silently include them in scope.

### Out-of-plan changes

- `docs/features/AGT-3-bounded-note-tools.md` — story status/evidence bookkeeping; expected for story progress but not listed in Section 7.

---

## Findings

### Test Coverage (`TEST-#`)

None.

### Reliability (`REL-#`)

None.

### Security (`SEC-#`)

None.

### API Contracts (`API-#`)

None.

---

## Required actions before QA

(None — gate passed.)

---

## Notes

- Prior `TEST-1` is resolved: `tests/integration/agent-note-tools.integration.test.ts` now imports `SqliteDocumentStore` and `openMigratedMemoryDb`, seeds an in-memory migrated SQLite store, and runs B4/C3 through `AgentNoteToolRunner` without `SearchTestStore`.
- Prior `TEST-2` is resolved: changed AGT-3 tests now include `@scenario S3`, `@scenario S4`, and `@scenario S9` annotations across unit, contract, and integration coverage.
- Prior `API-1` is resolved: `AgentNoteToolRunner` now resolves standalone `notePath` read targets through `IDocumentStore.getNodesByNote`, and `tests/core/workflows/AgentNoteToolRunner.test.ts::C1_read_note_uses_document_store` covers `notePath` without prior search results.
- Verification run: `npm test -- --run tests/core/domain/agentNoteTools.test.ts tests/core/workflows/AgentNoteToolRunner.test.ts tests/contract/agent-note-tools.contract.ts tests/integration/agent-note-tools.integration.test.ts` passed 17/17 tests.
- Verification run: `npm run typecheck` passed.
- Verification run: `npm run lint` passed.
- Verification run: `npm run build` passed with one existing esbuild warning about `import.meta` in CJS output.
- Static check: `rg "\\bany\\b" src/core/domain/agentNoteTools.ts src/core/workflows/AgentNoteToolRunner.ts src/core/domain/agentRetrievalPlan.ts` returned no matches.
