REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: AGT-2 — Retrieval plan contract and deterministic plan tests

**Reviewed against:** `docs/features/AGT-2-retrieval-plan-contract.md`
**Date:** 2026-04-30
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: AGT-2
- Linked refined requirements (Sn IDs in scope): REQ-007 S1, S2, S7 (retrieval-plan portion)
- Files in scope (from Section 7 "Files to CREATE/MODIFY" intersected with `git diff` when available):
  - `src/core/domain/agentRetrievalPlan.ts` — created
  - `src/core/ports/IAgentPlannerPort.ts` — created
  - `tests/core/domain/agentRetrievalPlan.test.ts` — created
  - `tests/contract/agent-planner.contract.ts` — created
  - `src/core/index.ts` — modified
  - `src/core/ports/index.ts` — modified
  - `vitest.config.ts` — modified
  - `src/core/workflows/ChatWorkflow.ts` — modified
- Tests in scope (from Section 8a Test Plan):
  - `tests/core/domain/agentRetrievalPlan.test.ts::A1_exports_plan_contract_shapes` through `Z5_no_raw_prompt_or_note_content_required_for_plan_key`
  - `tests/contract/agent-planner.contract.ts::C1_port_contract_signature` through `C4_contract_ready_plan_search_only_tools`
  - `npm run build`, `npm run lint`, `npm run typecheck`
  - `rg "\\bany\\b" ...`
  - `/review-story AGT-2`
- Adapters in scope (from Section 4b):
  - None. AGT-2 creates `IAgentPlannerPort`; PRV-3 owns the first real adapter.

If the diff includes files **not** listed in Section 7, list them under "Out-of-plan changes" below — do not silently include them in scope.

### Out-of-plan changes

- `docs/features/AGT-2-retrieval-plan-contract.md` — story status/evidence bookkeeping; expected for story progress but not listed in Section 7.
- `tests/core/workflows/ChatWorkflow.dateRange.test.ts` — adds focused coverage for the Section 7 `ChatWorkflow.ts` optional `log.info` change.
- `tests/integration/chat-last-two-weeks.integration.test.ts` — BUG-3 test type assertion tweak; not AGT-2 scope.
- `tests/plugin/settings/SettingsTab.timezone.test.ts` — BUG-3 test assertion tweak; not AGT-2 scope.

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

- Prior `TEST-1` is resolved: changed tests now include `@scenario S1`, `@scenario S2`, and `@scenario S7` annotations in `tests/core/domain/agentRetrievalPlan.test.ts` and `tests/contract/agent-planner.contract.ts`.
- Prior `TEST-2` is resolved: `tests/core/workflows/ChatWorkflow.dateRange.test.ts::AGT2_optional_info_logger_does_not_block_date_resolution` covers the optional `log.info` runtime path.
- Prior `API-1` is resolved: `normalizeRetrievalPlan` now rejects ready plans without a `search_notes` tool call, with unit coverage in `A2_ready_plan_requires_search_notes`.
- Prior `API-2` is resolved: date range `start`/`end` values are validated as real `YYYY-MM-DD` dates, with unit coverage in `B4_invalid_date_ranges_are_rejected`.
- Verification run: `npx vitest run tests/core/domain/agentRetrievalPlan.test.ts tests/contract/agent-planner.contract.ts tests/core/workflows/ChatWorkflow.dateRange.test.ts` passed 20/20 tests.
- Verification run: `npm run typecheck` passed.
- Verification run: `npm run lint` passed.
- Verification run: `npm run build` passed with one existing esbuild warning about `import.meta` in CJS output.
- Static check: `rg "\\bany\\b" src/core/domain/agentRetrievalPlan.ts src/core/ports/IAgentPlannerPort.ts tests/core/domain/agentRetrievalPlan.test.ts tests/contract/agent-planner.contract.ts` returned no matches.
