# AGT-4: Agentic ChatWorkflow loop - plan, tools, synthesize

**Story**: Wire `ChatWorkflow` from single-shot RAG to a bounded agentic loop that plans retrieval, executes AGT-3 note tools, and streams a grounded answer or draft using the existing chat provider port.
**Epic**: 12 - Deterministic agentic note synthesis (REQ-007)
**Size**: Large
**Status**: Open

---

## 1. Summary

AGT-4 is the orchestration story for Epic 12. AGT-2 defines the retrieval plan contract, AGT-3 implements bounded note tools, and PRV-3 provides the first real Ollama planner adapter. This story connects those pieces in `ChatWorkflow` and sidecar runtime wiring so synthesis prompts run as `plan -> tools -> grounded completion` instead of `raw prompt -> search -> completion`.

The workflow must still preserve existing chat behavior for insufficient evidence, grounding policy ordering, cancellation/timeouts, source provenance, hybrid search, date/path filters, and user prompt settings. The planner determines retrieval intent before vector or keyword search. The tool runner executes planned `search_notes`, `read_note`, and `assemble_draft` steps within fixed budgets. The final chat provider receives only grounded context assembled from tool results.

AGT-4 should include a migration path that keeps ordinary chat tests passing. If the planner returns `needs_scope`, no search/tool execution occurs and the workflow returns an insufficient-evidence-style terminal response identifying the missing scope.

**Linked REQ:** [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md). **Primary ADR:** [ADR-018](../decisions/ADR-018-deterministic-agentic-note-synthesis.md).

**In scope from REQ-007:** S1, S2, S3, S6, S7, and S9.

**Out of scope from REQ-007:**

| Sn | Owner | Why out of scope for AGT-4 |
|----|-------|----------------------------|
| S4 | AGT-5 | AGT-4 can stream the grounded response/draft payload, but polished topic-synthesis structure and requested-format handling are owned by AGT-5. |
| S5 | AGT-5 | Final source presentation for synthesized drafts belongs with synthesis output. |
| S8 | AGT-6 | AGT-4 may expose trace hooks, but full structured logging/token usage coverage is AGT-6. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`](../decisions/ADR-018-deterministic-agentic-note-synthesis.md) | Primary ADR: changes chat to `interpret prompt -> retrieval plan -> bounded note tools -> grounded answer or draft`. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | `ChatWorkflow` must depend on planner/tool/chat ports, not provider-specific adapters. |
| [`docs/decisions/ADR-009-chat-cancellation-and-timeout.md`](../decisions/ADR-009-chat-cancellation-and-timeout.md) | Abort and timeout must still terminate streamed completion promptly. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Final provider messages must preserve built-in grounding policy and insufficient-evidence behavior. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Plan/tool scopes must carry path/date/tag filters through retrieval. |
| [`docs/decisions/ADR-015-source-provenance-contract.md`](../decisions/ADR-015-source-provenance-contract.md) | Final `sources` must equal notes whose content contributed to the answer or draft. |
| [`docs/decisions/ADR-016-natural-language-date-range-resolution.md`](../decisions/ADR-016-natural-language-date-range-resolution.md) | Existing date resolution must feed planner input and must not be silently replaced by model-only date parsing. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**.
- [x] README, requirements, and ADRs agree on sidecar workflow ownership, provider abstraction, grounding, filtering, provenance, and draft-only behavior.
- [x] Section 4 lists binding constraints from ADR-018 and related ADRs.
- [x] Section 4b lists every port/adapter touched by workflow wiring.
- [x] Section 8a Test Plan covers every AC ID and implemented REQ-007 scenario.
- [x] Planner and note-tool ports have contract coverage; sidecar wiring has integration evidence with deterministic fakes.
- [x] REQ-007 S1, S2, S3, S6, S7, and S9 are mapped to tests; out-of-scope Sn IDs are listed in Section 1.
- [x] Phase Y includes non-mock workflow evidence that retrieval happens only after planning and tools stay bounded.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** - `ChatWorkflow` must call `IAgentPlannerPort.planRetrieval` before any vector, keyword, note-read, or draft assembly tool runs.
2. **Y2** - If the planner returns `needs_scope`, `ChatWorkflow` must not call `runSearch`, `IAgentNoteToolPort`, `IDocumentStore`, or `IChatPort.complete`.
3. **Y3** - Ready plans execute only AGT-3 bounded note tools, in normalized plan order, respecting fixed planner/tool budgets.
4. **Y4** - Final provider context is assembled from tool results only; raw prompt text must not be used as retrieval context and external sources are forbidden.
5. **Y5** - Final `sources` equals the deduped note set whose content from tool results is included in the grounded context or draft.
6. **Y6** - Existing `systemPrompt`, `vaultOrganizationPrompt`, grounding policy, cancellation, timeout, path/date filters, and hybrid settings remain honored.
7. **Y7** - Equivalent prompt/settings/model/vault fingerprint with deterministic planner/tool/chat fakes produces equivalent plan, source set, and output structure.
8. **Y8** - AGT-4 remains draft-only and must not call `AgentNoteWriter`, `IVaultAccessPort`, Obsidian vault write APIs, or filesystem write APIs.

---

## 4b. Ports & Adapters

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IAgentPlannerPort` | `src/core/ports/IAgentPlannerPort.ts` | `OllamaAgentPlannerAdapter` from PRV-3; deterministic fixture planner in workflow tests | Contract fixture plus PRV-3 Ollama HTTP fixture | AGT-4 consumes the port and does not implement provider HTTP calls. |
| `IAgentNoteToolPort` | `src/core/ports/IAgentNoteToolPort.ts` | `AgentNoteToolRunner` from AGT-3; deterministic fixture runner in workflow tests | AGT-3 runner integration tests plus workflow fakes | AGT-4 consumes the port and does not duplicate search/read logic. |
| `IChatPort` | `src/core/ports/IChatPort.ts` | Existing `OpenAIChatAdapter` / `OllamaChatAdapter`; recording fake in tests | Existing chat adapter contract/integration tests | AGT-4 still uses the existing final completion boundary. |

---

## 5. API Endpoints + Schemas

No user-facing sidecar route is added. The existing `chat` stream remains:

```ts
{ type: 'delta'; delta: string }
{ type: 'done'; sources: Source[]; groundingOutcome: GroundingOutcome; groundingPolicyVersion: string }
```

AGT-4 may extend core-only workflow result metadata for AGT-6 logging, but `SidecarRuntime.handleChatStream` must not expose retrieval plans, tool traces, raw note content, or token details on the chat wire.

`ChatWorkflowDeps` should gain injected ports:

```ts
interface ChatWorkflowDeps {
  planner: IAgentPlannerPort;
  noteTools: IAgentNoteToolPort;
  chat: IChatPort;
  buildGroundedMessages: (...args) => ChatMessage[];
}
```

The exact shape may be adjusted to preserve existing tests, but AGT-4 must keep dependencies explicit and injectable.

---

## 6. Frontend Flow

No frontend UI changes are required. The chat pane still sends the same `chat` payload and consumes the same streaming chunks. Behavioral change is inside the sidecar.

### 6a. Component / Data Hierarchy

```text
ChatView
└── ISidecarTransport.streamChat(payload)
    └── SidecarRuntime.handleChatStream
        └── ChatWorkflow.runChatStream
            ├── IAgentPlannerPort.planRetrieval
            ├── IAgentNoteToolPort.runTool
            ├── buildGroundedMessages
            └── IChatPort.complete
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatView` | unchanged | existing loading/error/success states | No new UI state in AGT-4. |
| `ISidecarTransport.streamChat` | unchanged payload + abort option | existing stream handling | Final done payload shape is unchanged. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Existing streaming indicator remains. |
| Error | Existing transport/provider error path remains. |
| Empty / needs scope | Existing insufficient-evidence style message is streamed with `sources: []`. |
| Success | Existing assistant message stream and source chips remain. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `tests/core/workflows/ChatWorkflow.agentic.test.ts` | Core tests for planning before tools, `needs_scope`, tool loop, stable source set, draft-only behavior. |
| 2 | `tests/sidecar/runtime/SidecarRuntime.agentic.test.ts` | Sidecar dependency wiring tests for planner/tool/chat ports and unchanged wire payload. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/ChatWorkflow.ts` | Replace single-shot retrieval path for synthesis prompts with injected planner/tool loop while preserving grounding, cancellation, filters, and source semantics. |
| 2 | `src/core/workflows/chatStreamGuard.ts` | Modify only if timeout/abort handling needs to cover planner/tool phases; otherwise leave unchanged. |
| 3 | `src/sidecar/runtime/SidecarRuntime.ts` | Construct planner/tool deps and inject them into `ChatWorkflow`; use PRV-3 planner factory when available. |
| 4 | `tests/integration/chatWorkflowDeps.ts` | Update test helper for new workflow deps. |
| 5 | Existing `tests/core/workflows/ChatWorkflow*.test.ts` | Update expectations where the planner/tool loop supersedes direct search behavior, preserving existing grounding/filter/source tests. |
| 6 | `README.md` | Link AGT-4 from the Epic 12 backlog row. |

### Files UNCHANGED (confirm no modifications needed)

- `src/plugin/ui/ChatView.ts` - wire payload and rendering remain unchanged.
- `src/plugin/client/StdioTransportAdapter.ts` - chat stream shape remains unchanged.
- `src/plugin/client/HttpTransportAdapter.ts` - chat stream shape remains unchanged.
- `src/plugin/agent/AgentNoteWriter.ts` - file writing remains out of scope.
- `src/sidecar/adapters/OllamaAgentPlannerAdapter.ts` - PRV-3 owns provider adapter behavior.
- `src/core/workflows/AgentNoteToolRunner.ts` - AGT-3 owns tool implementation.

---

## 8. Acceptance Criteria Checklist

### Phase A: Workflow Dependency Wiring

- [ ] **A1** - `ChatWorkflowDeps` accepts injected planner and note-tool ports.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::A1_accepts_planner_and_tool_ports(vitest)`

- [ ] **A2** - `SidecarRuntime` wires planner, note-tool runner, chat port, search/store/embedder deps, grounding builder, and abort/timeout into `runChatStream`.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.agentic.test.ts::A2_runtime_wires_agentic_deps(vitest)`

### Phase B: Plan Before Retrieval

- [ ] **B1** - The workflow calls `IAgentPlannerPort.planRetrieval` before any search/tool execution.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::B1_plans_before_tools_or_search(vitest)` - covers S1

- [ ] **B2** - Planner input includes user prompt, conversation, `vaultOrganizationPrompt`, explicit path/date filters, daily-note globs, anchor date, model config ID, and vault index fingerprint.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::B2_planner_input_contains_settings_and_fingerprint(vitest)` - covers S1, S7

- [ ] **B3** - `needs_scope` produces an insufficient-evidence-style terminal result without search, tools, or provider completion.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::B3_needs_scope_skips_tools_and_provider(vitest)` - covers S2

### Phase C: Bounded Tool Loop

- [ ] **C1** - Ready plans execute planned AGT-3 tool calls in normalized order.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::C1_executes_planned_tools_in_order(vitest)` - covers S3

- [ ] **C2** - Tool loop stops at fixed budgets and does not execute unsafe fallback searches or writes.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::C2_tool_budget_stop_is_terminal(vitest)` - covers S3, S9

- [ ] **C3** - Plan-derived filters and output intent are forwarded to `IAgentNoteToolPort.runTool`.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::C3_forwards_plan_scope_to_tools(vitest)` - covers S3

### Phase D: Grounded Completion and Sources

- [ ] **D1** - Final provider messages include built-in grounding, vault organization prompt, user system prompt, tool-derived context, conversation history, and current user turn in ADR-011 order.
  - Evidence: `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts::D1_agentic_context_preserves_grounding_order(vitest)` - covers S6

- [ ] **D2** - Final `sources` equals the deduped note set whose tool-result content is included in grounded context.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::D2_sources_match_tool_context(vitest)` - covers S6

- [ ] **D3** - Equivalent deterministic planner/tool/chat fakes produce the same retrieval plan key, source set, and output structure.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::D3_repeated_runs_stable_source_set(vitest)` - covers S7

- [ ] **D4** - Chat cancellation and timeout still terminate the final provider stream promptly.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::D4_abort_and_timeout_still_stop_stream(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** - **(binding)** Planning happens before retrieval/tool execution.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::B1_plans_before_tools_or_search(vitest)` - maps Section 4 Y1

- [ ] **Y2** - **(binding)** `needs_scope` cannot trigger search, tools, or provider completion.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::B3_needs_scope_skips_tools_and_provider(vitest)` - maps Section 4 Y2

- [ ] **Y3** - **(binding)** Ready plans execute only bounded AGT-3 tools.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::C1_executes_planned_tools_in_order(vitest)` - maps Section 4 Y3 and Section 4b note-tool port row

- [ ] **Y4** - **(binding)** Final context is assembled from tool results only and stays vault-only.
  - Evidence: `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts::D1_agentic_context_preserves_grounding_order(vitest)` - maps Section 4 Y4

- [ ] **Y5** - **(binding)** Sources equal contributing tool-result notes.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::D2_sources_match_tool_context(vitest)` - maps Section 4 Y5

- [ ] **Y6** - **(binding)** Existing chat settings, filters, cancellation, and timeout remain honored.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::D4_abort_and_timeout_still_stop_stream(vitest)` - maps Section 4 Y6 and Section 4b chat port row

- [ ] **Y7** - **(binding)** Equivalent deterministic runs preserve plan/source/output structure.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::D3_repeated_runs_stable_source_set(vitest)` - maps Section 4 Y7 and Section 4b planner port row

- [ ] **Y8** - **(binding)** Workflow remains draft-only with no vault-write surface.
  - Evidence: `tests/core/workflows/ChatWorkflow.agentic.test.ts::Y8_no_vault_write_surface(vitest)` - maps Section 4 Y8

### Phase Z: Quality Gates

- [ ] **Z1** - `npm run build` passes with zero TypeScript errors in all workspaces.
- [ ] **Z2** - `npm run lint` passes, or only has pre-existing warnings.
- [ ] **Z3** - No `any` types in any new or modified file.
- [ ] **Z4** - All client imports from shared use `@shared/types` alias where applicable; AGT-4 core/sidecar changes should not add client shared imports.
- [ ] **Z5** - New trace/log fields avoid raw note content and secrets; full log coverage is deferred to AGT-6.
- [ ] **Z6** - `/review-story AGT-4` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface.

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::A1_accepts_planner_and_tool_ports` | A1 |  | Dependency shape. |
| 2 | integration | `tests/sidecar/runtime/SidecarRuntime.agentic.test.ts::A2_runtime_wires_agentic_deps` | A2 |  | Sidecar wiring. |
| 3 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::B1_plans_before_tools_or_search` | B1, Y1 | S1 | Ordering spy. |
| 4 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::B2_planner_input_contains_settings_and_fingerprint` | B2 | S1, S7 | Planner input fields. |
| 5 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::B3_needs_scope_skips_tools_and_provider` | B3, Y2 | S2 | No search/tool/provider calls. |
| 6 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::C1_executes_planned_tools_in_order` | C1, Y3 | S3 | Tool loop order. |
| 7 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::C2_tool_budget_stop_is_terminal` | C2 | S3, S9 | Budget stop. |
| 8 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::C3_forwards_plan_scope_to_tools` | C3 | S3 | Scope forwarding. |
| 9 | integration | `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts::D1_agentic_context_preserves_grounding_order` | D1, Y4 | S6 | Grounded message order. |
| 10 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::D2_sources_match_tool_context` | D2, Y5 | S6 | Provenance. |
| 11 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::D3_repeated_runs_stable_source_set` | D3, Y7 | S7 | Deterministic fakes. |
| 12 | unit | `tests/core/workflows/ChatWorkflow.agentic.test.ts::D4_abort_and_timeout_still_stop_stream` | D4, Y6 |  | ADR-009 regression. |
| 13 | static | `tests/core/workflows/ChatWorkflow.agentic.test.ts::Y8_no_vault_write_surface` | Y8 | S9 | No write imports/calls. |
| 14 | static | `package.json scripts + TypeScript compiler::npm run build` | Z1, Z3 |  | Build/no-`any` quality gate. |
| 15 | static | `eslint.config.mjs::npm run lint` | Z2, Z3, Z5 |  | Lint quality gate. |
| 16 | review | `/review-story AGT-4` | Z6 |  | Required story review gate. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Replacing the single-shot path may break existing filter/source behavior. | Keep existing ChatWorkflow regression tests and add agentic equivalents before changing behavior. |
| 2 | AGT-4 and PRV-3 can overlap on sidecar planner factory wiring. | PRV-3 owns adapter/factory behavior; AGT-4 only consumes the planner port and runtime injection. |
| 3 | It may be tempting to expose plans/tool traces on the chat wire. | Keep user-facing wire shape unchanged; AGT-6 handles logs, not chat payload expansion. |
| 4 | Source provenance can drift when synthesis drops over-budget context. | Make context inclusion the source-of-truth for `sources`, as in ADR-015. |

---

## Implementation Order

1. `tests/core/workflows/ChatWorkflow.agentic.test.ts` - write red tests for planner-first ordering, `needs_scope`, tool execution order, source provenance, stability, and no write surface (covers B1-D4, Y1-Y8).
2. `src/core/workflows/ChatWorkflow.ts` - add injected planner/tool deps and build `AgentPlanInput` from chat options and settings (covers A1, B1, B2).
3. `src/core/workflows/ChatWorkflow.ts` - implement `needs_scope` and ready-plan tool loop paths (covers B3, C1-C3).
4. `src/core/workflows/ChatWorkflow.ts` - assemble grounded context from tool results and preserve provider streaming/cancellation behavior (covers D1-D4).
5. `src/sidecar/runtime/SidecarRuntime.ts` and `tests/sidecar/runtime/SidecarRuntime.agentic.test.ts` - wire runtime deps using PRV-3 planner factory and AGT-3 tool runner (covers A2).
6. Update existing `ChatWorkflow*.test.ts` only where expectations legitimately change; preserve filter, date, hybrid, grounding, source, timeout, and insufficient-evidence regression coverage.
7. `README.md` - link AGT-4 row only.
8. **Final verify** - run `npm run build`, `npm run lint`, focused ChatWorkflow/runtime tests, and `/review-story AGT-4` (covers Z1-Z6).

---

*Created: 2026-04-30 | Story: AGT-4 | Epic: 12 - Deterministic agentic note synthesis*
