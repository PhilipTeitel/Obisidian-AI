REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: AGT-6 — Agent observability - retrieval plan, tool trace, token usage, budgets

**Reviewed against:** `docs/features/AGT-6-agent-observability.md`
**Date:** 2026-05-01
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: AGT-6
- Linked refined requirements (Sn IDs in scope): S8, plus budget-warning portions of S3
- Files in scope (from Section 7 "Files to CREATE/MODIFY" intersected with `git diff` when available):
  - `README.md` — modified
  - `src/core/domain/agentRunTrace.ts` — created
  - `tests/core/domain/agentRunTrace.test.ts` — created
  - `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts` — created
  - `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts` — created
  - `src/core/domain/agentRetrievalPlan.ts` — modified
  - `src/core/index.ts` — modified
  - `src/core/workflows/ChatWorkflow.ts` — modified
  - `src/core/ports/IChatPort.ts` — modified
  - `src/sidecar/adapters/OllamaChatAdapter.ts` — modified
  - `src/sidecar/adapters/OpenAIChatAdapter.ts` — modified
  - `src/sidecar/adapters/OllamaAgentPlannerAdapter.ts` — created
  - `src/sidecar/runtime/SidecarRuntime.ts` — modified
  - `tests/sidecar/adapters/OllamaChatAdapter.test.ts` — modified
  - `tests/sidecar/adapters/OpenAIChatAdapter.test.ts` — modified
- Tests in scope (from Section 8a Test Plan):
  - `tests/core/domain/agentRunTrace.test.ts::A1_plan_summary_redacts_sensitive_content`
  - `tests/core/domain/agentRunTrace.test.ts::A2_tool_summary_excludes_content`
  - `tests/core/domain/agentRunTrace.test.ts::A3_source_summary_matches_used_sources`
  - `tests/core/domain/agentRunTrace.test.ts::A4_usage_reported_vs_unavailable`
  - `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B1_logs_agent_run_lifecycle`
  - `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B2_budget_exceeded_logs_warn`
  - `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B3_logs_redact_content_and_secrets`
  - `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B4_logs_provider_usage_or_unavailable`
  - `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B5_chat_wire_payload_unchanged`
  - `tests/sidecar/adapters/OllamaChatAdapter.test.ts::C1_reports_usage_when_available`
  - `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C1_reports_planner_usage_when_available`
  - `tests/sidecar/adapters/OpenAIChatAdapter.test.ts::C2_usage_unavailable_is_nonfatal`
  - `tests/core/domain/agentRunTrace.test.ts::Y8_no_persistence_write_or_budget_setting_surface`
  - `package.json scripts + TypeScript compiler::npm run build`
  - `eslint.config.mjs::npm run lint`
  - `/review-story AGT-6`
- Adapters in scope (from Section 4b):
  - `OllamaChatAdapter` for port `IChatPort`
  - `OpenAIChatAdapter` for port `IChatPort`
  - `OllamaAgentPlannerAdapter` for port `IAgentPlannerPort`
  - Sidecar logger / pino runtime logging boundary

If the diff includes files **not** listed in Section 7, list them under "Out-of-plan changes" below — do not silently include them in scope.

### Out-of-plan changes

- `docs/features/AGT-6-agent-observability.md` — story source changed during implementation; expected as tracking, but not part of implementation scope.

---

## Findings

(One subsection per category with at least one finding; categories with no findings can be written as `None.`. Use bullets per finding — never a single category-spanning table.)

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

None.

---

## Notes

- Scenario traceability evidence now exists in the changed AGT-6 tests: `rg "S3|S8|@scenario" tests/core/domain/agentRunTrace.test.ts`, `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts`, and `tests/sidecar/adapters/*.test.ts` returns S8 markers, plus the budget-warning runtime test marker `// @scenario S3 S8`.
- Focused AGT-6 tests passed: `npm test -- tests/core/domain/agentRunTrace.test.ts tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts tests/sidecar/adapters/OllamaChatAdapter.test.ts tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts tests/sidecar/adapters/OpenAIChatAdapter.test.ts` (5 files passed, 20 tests passed).
- `npm run build` passed with one esbuild warning about `import.meta` in CommonJS output; `npm run lint` passed.
- Generated DB fixtures no longer appear in the current working-tree diff.
