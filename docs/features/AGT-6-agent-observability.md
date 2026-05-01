# AGT-6: Agent observability - retrieval plan, tool trace, token usage, budgets

**Story**: Add structured sidecar observability for agent runs: retrieval plan summaries, tool activity, source set, budget warnings, and actual provider token usage when reported.
**Epic**: 12 - Deterministic agentic note synthesis (REQ-007)
**Size**: Medium
**Status**: Open

---

## 1. Summary

AGT-6 makes the agentic workflow debuggable. ADR-018 requires the sidecar to log the structured retrieval plan, searches performed, notes read, source set used for synthesis, actual provider token usage when available, and `warn` events when fixed budgets are exceeded. AGT-4/AGT-5 perform the workflow; AGT-6 defines and verifies the logging surface.

Logs must be useful for debugging why a source was used without leaking raw note content, prompts, API keys, or secrets. The story should add stable correlation fields for a single agent run, compact plan/tool/source summaries, provider usage fields when adapters report them, and explicit `usageUnavailable` fields when providers do not report usage.

**Linked REQ:** [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md). **Primary ADR:** [ADR-018](../decisions/ADR-018-deterministic-agentic-note-synthesis.md).

**In scope from REQ-007:** S8, plus budget-warning portions of S3.

**Out of scope from REQ-007:**

| Sn | Owner | Why out of scope for AGT-6 |
|----|-------|----------------------------|
| S1 | AGT-2 / PRV-3 / AGT-4 | Planning behavior exists before logging. |
| S2 | AGT-2 / AGT-4 | Planning failure behavior exists before logging. |
| S4 | AGT-5 | Draft content formatting is not observability. |
| S5 | AGT-5 | User-facing source presentation is not logging. |
| S6 | AGT-4 / AGT-5 | Final output grounding exists before logging. |
| S7 | AGT-2 / AGT-4 / AGT-5 | Determinism behavior is tested in prior stories; AGT-6 logs enough metadata to inspect it. |
| S9 | AGT-3 / AGT-4 / AGT-5 | Draft-only behavior is enforced elsewhere; AGT-6 must not add writes. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`](../decisions/ADR-018-deterministic-agentic-note-synthesis.md) | Requires retrieval-plan/tool/source/token logs and budget warnings. |
| [`docs/decisions/ADR-010-structured-logging-sidecar.md`](../decisions/ADR-010-structured-logging-sidecar.md) | Sidecar logs are structured JSON with redaction and levels. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Logs must not imply external sources or expose raw context. |
| [`docs/decisions/ADR-015-source-provenance-contract.md`](../decisions/ADR-015-source-provenance-contract.md) | Logged source set must match sources used for the reply/draft. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | Provider usage reporting must remain additive behind provider-neutral shapes. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**.
- [x] README, requirements, and ADRs agree that plans/tool activity/token usage are logged, not returned on the user-facing chat wire.
- [x] Section 4 lists binding logging and redaction constraints.
- [x] Section 4b lists provider/logging boundaries and usage metadata handling.
- [x] Section 8a Test Plan covers every AC ID and implemented REQ-007 scenario.
- [x] REQ-007 S8 and budget-warning portions of S3 are mapped to tests; out-of-scope Sn IDs are listed in Section 1.
- [x] Phase Y includes evidence for structured logs, redaction, and budget warnings.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** - Each agent chat run has a correlation ID included in plan, tool, synthesis, source, usage, and final completion log events.
2. **Y2** - The retrieval plan is logged as a compact structured summary: plan key, status, task/topic hashes or safe labels, filters, output kind/format, and tool-call count. Raw note content and secrets are forbidden.
3. **Y3** - Each tool execution logs type, status, result count, source count, used-node count, and budget flags. Tool logs do not include raw snippets or node content.
4. **Y4** - The final source set used for synthesis is logged as counts and safe note-path metadata consistent with README logging rules; no unused source appears.
5. **Y5** - Budget exhaustion logs at `warn` with budget name, configured constant, observed count/estimate, and run correlation ID.
6. **Y6** - Actual provider token usage is logged when reported by the planner or final chat provider; unavailable usage is logged distinctly and does not rely only on token estimates.
7. **Y7** - Planner/tool/usage logs are not exposed on the chat wire payload.
8. **Y8** - AGT-6 must not add persistent trace tables, vault writes, or new plugin settings for budgets.

---

## 4b. Ports & Adapters

AGT-6 does not add a new external provider. It may add core/sidecar metadata interfaces so provider adapters can expose usage without changing chat semantics.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IChatPort` | `src/core/ports/IChatPort.ts` | Existing OpenAI/Ollama chat adapters | Existing adapter tests plus provider-shaped usage fixtures if the port is extended | If token usage is added, keep it provider-neutral and backward-compatible. |
| `IAgentPlannerPort` | `src/core/ports/IAgentPlannerPort.ts` | PRV-3 Ollama planner adapter | Ollama-shaped planner fixture with optional usage fields | Usage metadata is optional; absence must be logged as unavailable. |
| Sidecar logger | `src/sidecar/logging/logger.ts` / `pino` runtime logger | Existing sidecar logger | Capturing pino destination in tests | Logs are the integration boundary for AGT-6. |

---

## 5. API Endpoints + Schemas

No user-facing API or chat stream payload change is required. Logs are sidecar-internal.

Core/sidecar metadata may use shapes like:

```ts
export interface AgentRunTrace {
  agentRunId: string;
  planKey?: string;
  plannerUsage?: ProviderTokenUsage;
  completionUsage?: ProviderTokenUsage;
}

export interface ProviderTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  source: 'reported' | 'unavailable';
}
```

If existing `IChatPort.complete` cannot expose terminal usage without disrupting streaming, the implementer may add optional callbacks in `ChatCompletionOptions` rather than changing yielded delta semantics.

---

## 6. Frontend Flow

Frontend work is not applicable. AGT-6 logs are for sidecar debugging and review; they are not surfaced in `ChatView`.

### 6a. Component / Data Hierarchy

```text
ChatView (unchanged)
└── SidecarRuntime.handleChatStream
    ├── agent.run_started log
    ├── agent.plan log
    ├── agent.tool log(s)
    ├── agent.sources log
    ├── agent.usage log
    └── agent.run_done log
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| N/A | N/A | N/A | No frontend changes. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| N/A | No user-facing state changes in AGT-6. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/agentRunTrace.ts` | Provider-neutral trace/usage metadata types and safe serialization helpers. |
| 2 | `tests/core/domain/agentRunTrace.test.ts` | Unit tests for redaction, compact plan summaries, tool summaries, source summaries, and usage normalization. |
| 3 | `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts` | Captured logger tests for agent run lifecycle, plan/tool/source/usage logs, and budget warnings. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/ChatWorkflow.ts` | Emit trace metadata/callbacks for plan, tools, source set, budget flags, and usage hooks. |
| 2 | `src/core/workflows/AgentNoteToolRunner.ts` | Ensure trace fields are sufficient for sidecar logging; avoid raw content. |
| 3 | `src/core/ports/IChatPort.ts` | Add optional usage callback support only if needed and backward-compatible. |
| 4 | `src/sidecar/adapters/OllamaChatAdapter.ts` | Capture reported usage fields if Ollama includes them; log unavailable otherwise. |
| 5 | `src/sidecar/adapters/OpenAIChatAdapter.ts` | Capture reported usage fields if available in non-stream or final streaming chunks; log unavailable otherwise. |
| 6 | `src/sidecar/adapters/OllamaAgentPlannerAdapter.ts` | Preserve reported planner usage if PRV-3 response exposes it. |
| 7 | `src/sidecar/runtime/SidecarRuntime.ts` | Generate agent run ID and write structured plan/tool/source/usage/budget logs. |
| 8 | `README.md` | Link AGT-6 from the Epic 12 backlog row. |

### Files UNCHANGED (confirm no modifications needed)

- `src/plugin/ui/ChatView.ts` - logs are not UI state.
- `src/plugin/settings/SettingsTab.ts` - no new budget settings.
- `src/sidecar/db/migrations/` - no persistent trace tables.
- `src/plugin/agent/AgentNoteWriter.ts` - no file writes.

---

## 8. Acceptance Criteria Checklist

### Phase A: Trace Shapes and Redaction

- [ ] **A1** - Agent trace helpers produce compact plan summaries without raw prompt, raw note content, API keys, or secrets.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A1_plan_summary_redacts_sensitive_content(vitest)` - covers S8

- [ ] **A2** - Tool trace summaries include counts/status/budget flags and exclude snippets/node content.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A2_tool_summary_excludes_content(vitest)` - covers S8

- [ ] **A3** - Source summaries match final source set semantics and avoid unused sources.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A3_source_summary_matches_used_sources(vitest)` - covers S8

- [ ] **A4** - Provider usage normalization distinguishes reported usage from unavailable usage.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A4_usage_reported_vs_unavailable(vitest)` - covers S8

### Phase B: Runtime Logs

- [ ] **B1** - Sidecar logs `agent.run_started`, `agent.plan`, `agent.tool`, `agent.sources`, `agent.usage`, and `agent.run_done` with one correlation ID.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B1_logs_agent_run_lifecycle(vitest)` - covers S8

- [ ] **B2** - Budget-exceeded tool or planner outcomes log `warn` with budget name, configured constant, observed value, and correlation ID.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B2_budget_exceeded_logs_warn(vitest)` - covers S3, S8

- [ ] **B3** - Logs never include raw note content, retrieval snippets, API keys, or full user prompts.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B3_logs_redact_content_and_secrets(vitest)` - covers S8

- [ ] **B4** - Planner and final completion token usage are logged when reported and logged as unavailable when not reported.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B4_logs_provider_usage_or_unavailable(vitest)` - covers S8

- [ ] **B5** - Chat stream `delta` and final `done` payloads do not expose plan/tool/usage logs.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B5_chat_wire_payload_unchanged(vitest)` - covers S8

### Phase C: Adapter Usage Metadata

- [ ] **C1** - Ollama chat/planner adapters capture reported usage fields when present in provider-shaped fixtures.
  - Evidence: `tests/sidecar/adapters/OllamaChatAdapter.test.ts::C1_reports_usage_when_available(vitest)` and `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C1_reports_planner_usage_when_available(vitest)` - covers S8

- [ ] **C2** - OpenAI chat adapter either captures streaming usage when available or marks usage unavailable without failing the stream.
  - Evidence: `tests/sidecar/adapters/OpenAIChatAdapter.test.ts::C2_usage_unavailable_is_nonfatal(vitest)` - covers S8

### Phase Y: Binding & stack compliance

- [ ] **Y1** - **(binding)** All agent log events include the same correlation ID.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B1_logs_agent_run_lifecycle(vitest)` - maps Section 4 Y1

- [ ] **Y2** - **(binding)** Retrieval plan logs are structured and redacted.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A1_plan_summary_redacts_sensitive_content(vitest)` - maps Section 4 Y2

- [ ] **Y3** - **(binding)** Tool logs include trace counts/status only, not content.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A2_tool_summary_excludes_content(vitest)` - maps Section 4 Y3

- [ ] **Y4** - **(binding)** Logged source set matches final used sources.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::A3_source_summary_matches_used_sources(vitest)` - maps Section 4 Y4

- [ ] **Y5** - **(binding)** Budget exhaustion emits `warn`.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B2_budget_exceeded_logs_warn(vitest)` - maps Section 4 Y5

- [ ] **Y6** - **(binding)** Actual provider token usage is logged when reported and unavailable is explicit.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B4_logs_provider_usage_or_unavailable(vitest)` - maps Section 4 Y6 and Section 4b provider rows

- [ ] **Y7** - **(binding)** Plan/tool/usage observability is not exposed on chat wire.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B5_chat_wire_payload_unchanged(vitest)` - maps Section 4 Y7

- [ ] **Y8** - **(binding)** AGT-6 adds no trace tables, vault writes, or budget settings.
  - Evidence: `tests/core/domain/agentRunTrace.test.ts::Y8_no_persistence_write_or_budget_setting_surface(vitest)` - maps Section 4 Y8

### Phase Z: Quality Gates

- [ ] **Z1** - `npm run build` passes with zero TypeScript errors in all workspaces.
- [ ] **Z2** - `npm run lint` passes, or only has pre-existing warnings.
- [ ] **Z3** - No `any` types in any new or modified file.
- [ ] **Z4** - All client imports from shared use `@shared/types` alias where applicable; AGT-6 sidecar/core changes should not add client shared imports.
- [ ] **Z5** - Logs use structured fields and redact raw note content, raw prompts, API keys, and secrets.
- [ ] **Z6** - `/review-story AGT-6` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface.

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/agentRunTrace.test.ts::A1_plan_summary_redacts_sensitive_content` | A1, Y2 | S8 | Plan summary redaction. |
| 2 | unit | `tests/core/domain/agentRunTrace.test.ts::A2_tool_summary_excludes_content` | A2, Y3 | S8 | Tool summary redaction. |
| 3 | unit | `tests/core/domain/agentRunTrace.test.ts::A3_source_summary_matches_used_sources` | A3, Y4 | S8 | Source summary semantics. |
| 4 | unit | `tests/core/domain/agentRunTrace.test.ts::A4_usage_reported_vs_unavailable` | A4 | S8 | Usage normalization. |
| 5 | integration | `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B1_logs_agent_run_lifecycle` | B1, Y1 | S8 | Correlated logs. |
| 6 | integration | `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B2_budget_exceeded_logs_warn` | B2, Y5 | S3, S8 | Warn budget. |
| 7 | integration | `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B3_logs_redact_content_and_secrets` | B3, Z5 | S8 | Redaction. |
| 8 | integration | `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B4_logs_provider_usage_or_unavailable` | B4, Y6 | S8 | Usage logging. |
| 9 | integration | `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts::B5_chat_wire_payload_unchanged` | B5, Y7 | S8 | Wire shape unchanged. |
| 10 | integration | `tests/sidecar/adapters/OllamaChatAdapter.test.ts::C1_reports_usage_when_available` | C1 | S8 | Ollama usage fixture. |
| 11 | integration | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C1_reports_planner_usage_when_available` | C1 | S8 | Planner usage fixture. |
| 12 | integration | `tests/sidecar/adapters/OpenAIChatAdapter.test.ts::C2_usage_unavailable_is_nonfatal` | C2 | S8 | OpenAI fallback. |
| 13 | static | `tests/core/domain/agentRunTrace.test.ts::Y8_no_persistence_write_or_budget_setting_surface` | Y8 | S9 | No persistence/settings/write surface. |
| 14 | static | `package.json scripts + TypeScript compiler::npm run build` | Z1, Z3 |  | Build/no-`any` quality gate. |
| 15 | static | `eslint.config.mjs::npm run lint` | Z2, Z3, Z5 |  | Lint quality gate. |
| 16 | review | `/review-story AGT-6` | Z6 |  | Required story review gate. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Logs could leak sensitive user content. | Centralize safe summary helpers and test redaction against raw prompt/snippet/API-key fixtures. |
| 2 | Provider usage may be unavailable in streaming APIs. | Log `source: 'unavailable'` explicitly; do not fail the request. |
| 3 | Extending `IChatPort` for usage metadata can break adapters. | Prefer optional callbacks in `ChatCompletionOptions` or backward-compatible optional metadata. |
| 4 | Too many log events can be noisy. | Use one lifecycle event set per agent run and compact summaries; reserve `warn` for budget/safety events. |

---

## Implementation Order

1. `tests/core/domain/agentRunTrace.test.ts` - write red tests for safe summaries, usage normalization, and no persistence/settings/write surface (covers A1-A4, Y2-Y4, Y8).
2. `src/core/domain/agentRunTrace.ts` - implement redacted plan/tool/source/usage summary helpers (covers A1-A4).
3. `tests/sidecar/runtime/SidecarRuntime.agentObservability.test.ts` - add captured-log tests for lifecycle events, budget warning, usage, redaction, and unchanged wire payload (covers B1-B5, Y1, Y5-Y7).
4. `src/core/workflows/ChatWorkflow.ts` and `src/sidecar/runtime/SidecarRuntime.ts` - add trace callbacks/correlation ID and structured logs (covers B1-B5).
5. Adapter tests and adapter changes - capture optional Ollama/OpenAI usage metadata where provider fixtures report it; mark unavailable otherwise (covers C1-C2).
6. `README.md` - link AGT-6 row only.
7. **Final verify** - run `npm run build`, `npm run lint`, focused observability/adapter tests, and `/review-story AGT-6` (covers Z1-Z6).

---

*Created: 2026-04-30 | Story: AGT-6 | Epic: 12 - Deterministic agentic note synthesis*
