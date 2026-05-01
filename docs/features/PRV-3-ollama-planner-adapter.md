# PRV-3: Ollama planner adapter support for pre-query reasoning

**Story**: Implement an Ollama-backed `IAgentPlannerPort` adapter that turns a user prompt, settings, and vault fingerprint into a normalized `AgentPlanResult` before retrieval runs.
**Epic**: 12 - Deterministic agentic note synthesis (REQ-007)
**Size**: Medium
**Status**: Open

---

## 1. Summary

PRV-3 provides the first real pre-query reasoning provider for the agentic chat flow. AGT-2 already defines `AgentPlanInput`, `RetrievalPlan`, `NeedsScopePlan`, normalization helpers, and the reusable planner contract. This story adds an Ollama adapter behind `IAgentPlannerPort` so AGT-4 can inject a real planner without embedding provider-specific HTTP calls in `ChatWorkflow`.

The adapter calls Ollama's local chat API, instructs the model to return a strict JSON plan draft, parses the response, and then uses AGT-2's normalization/validation helpers before returning the result. The adapter must preserve vault-only grounding, fixed planner budgets, one-week date defaults, prompt-requested output format, and deterministic normalization. It does not execute note tools, synthesize final prose, or write vault files.

**Linked REQ:** [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md). **Primary ADR:** [ADR-018](../decisions/ADR-018-deterministic-agentic-note-synthesis.md).

**In scope from REQ-007:** S1, S2, and the planner-provider portion of S7.

**Out of scope from REQ-007:**

| Sn | Owner | Why out of scope for PRV-3 |
|----|-------|----------------------------|
| S3 | AGT-3 / AGT-4 | Tool execution happens after planning. |
| S4 | AGT-4 / AGT-5 | Topic compilation and draft formatting happen after tools run. |
| S5 | AGT-5 | Draft source presentation is synthesis output work. |
| S6 | AGT-4 / AGT-5 | Final output generation is not part of the planner adapter. |
| S8 | AGT-6 | Runtime logging of plan/tool/token activity is a later observability story. PRV-3 may expose usage metadata for AGT-6 if Ollama reports it. |
| S9 | AGT-3 / AGT-4 | Draft-only enforcement belongs to tool/workflow execution. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`](../decisions/ADR-018-deterministic-agentic-note-synthesis.md) | Ollama is the first pre-query reasoning provider; plans must be explicit, bounded, and normalized before retrieval. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | Provider-specific behavior must sit behind a narrow port/adapter boundary. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Planner prompts cannot weaken vault-only grounding or allow external sources. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Plans express retrieval scope using existing `pathGlobs`, `dateRange`, and tags. |
| [`docs/decisions/ADR-016-natural-language-date-range-resolution.md`](../decisions/ADR-016-natural-language-date-range-resolution.md) | Explicit date scopes are supplied by callers; default one-week date-bounded synthesis uses AGT-2 normalization. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**.
- [x] README, requirements, and ADRs do not contradict each other on provider, transport, grounding, or integration boundaries.
- [x] Section 4 lists binding constraints from ADR-018, ADR-005, ADR-011, ADR-014, and ADR-016.
- [x] Section 4b lists the planner port and new Ollama adapter with integration evidence.
- [x] Section 8a Test Plan covers every AC ID and implemented REQ-007 scenario.
- [x] The adapter has both `IAgentPlannerPort` contract coverage and Ollama HTTP integration coverage using a hermetic `fetch` fixture.
- [x] REQ-007 S1, S2, and S7 are mapped to tests; out-of-scope Sn IDs are listed in Section 1.
- [x] Phase Y includes non-mock adapter-boundary evidence against an Ollama-shaped HTTP response.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** - The adapter implements `IAgentPlannerPort`; core workflow code must depend on the port, not Ollama HTTP details.
2. **Y2** - The adapter posts to Ollama's chat API using configured `baseUrl` and `model`; no OpenAI SDK or provider-specific dependency is introduced.
3. **Y3** - The adapter prompt requires JSON plan-draft output and must never include raw note content, API keys, or secrets.
4. **Y4** - Every adapter result is passed through `normalizeAgentPlanResult`; invalid, non-JSON, or grounding-weakening responses fail closed to a `needs_scope` result or typed planner error.
5. **Y5** - Planner budgets remain fixed constants in `agentRetrievalPlan.ts`; PRV-3 does not add user-configurable planner token or step settings.
6. **Y6** - Repeated adapter calls against the same deterministic Ollama fixture produce deep-equal normalized plans and `stablePlanKey` values.
7. **Y7** - `needs_scope` planner responses cannot contain `search_notes` or `read_note` tool calls.
8. **Y8** - PRV-3 does not execute retrieval, note tools, synthesis, or vault writes.

---

## 4b. Ports & Adapters

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IAgentPlannerPort` | `src/core/ports/IAgentPlannerPort.ts` | `OllamaAgentPlannerAdapter` (`src/sidecar/adapters/OllamaAgentPlannerAdapter.ts`) | Ollama `/api/chat` shaped HTTP fixture via `fetch` mock; optional local Ollama smoke test if available | Adapter returns normalized `AgentPlanResult`; AGT-4 injects it into `ChatWorkflow`. |

---

## 5. API Endpoints + Schemas

No plugin-side or sidecar wire endpoint changes are required. PRV-3 adds sidecar-internal adapter and factory code only.

New sidecar config:

```ts
export interface AgentPlannerAdapterConfig {
  baseUrl: string;
  model: string;
}

export function createAgentPlannerPort(
  kind: 'ollama',
  config: AgentPlannerAdapterConfig,
): IAgentPlannerPort;
```

Expected adapter behavior:

```ts
const planner = new OllamaAgentPlannerAdapter({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3.1',
});
const plan = await planner.planRetrieval(input);
```

Ollama response parsing must accept a JSON object in `message.content`. Optional fenced JSON may be stripped only if the implementation keeps parsing deterministic and tested.

---

## 6. Frontend Flow

Frontend work is not applicable for PRV-3. No UI, settings tab, or command behavior changes in this story.

### 6a. Component / Data Hierarchy

```text
ChatView (unchanged in PRV-3)
└── SidecarRuntime (AGT-4 consumes)
    └── IAgentPlannerPort
        └── OllamaAgentPlannerAdapter
            └── Ollama /api/chat
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| N/A | N/A | N/A | PRV-3 is sidecar adapter work only. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| N/A | No user-facing state changes in PRV-3. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/adapters/OllamaAgentPlannerAdapter.ts` | Ollama-backed `IAgentPlannerPort` implementation, strict prompt construction, JSON parsing, normalization, and failure handling. |
| 2 | `src/sidecar/adapters/createAgentPlannerPort.ts` | Planner adapter factory mirroring `createChatPort` / `createEmbeddingPort`. |
| 3 | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts` | Ollama-shaped fetch tests for ready plans, `needs_scope`, invalid JSON, grounding rejection, abort/timeout if supported. |
| 4 | `tests/sidecar/adapters/createAgentPlannerPort.test.ts` | Factory selection and config trimming tests. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `tests/contract/agent-planner.contract.ts` | Reuse the existing contract suite for the Ollama adapter fixture if the file exposes a factory hook cleanly. |
| 2 | `vitest.config.ts` | No change expected unless a new non-`.test.ts` contract file is added. |
| 3 | `README.md` | Link PRV-3 from the Epic 12 backlog row. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IAgentPlannerPort.ts` - AGT-2 already owns the port.
- `src/core/domain/agentRetrievalPlan.ts` - PRV-3 should use existing normalization helpers, not redefine the contract.
- `src/core/workflows/ChatWorkflow.ts` - AGT-4 owns planner/tool wiring.
- `src/sidecar/adapters/OllamaChatAdapter.ts` - PRV-3 should not overload the chat adapter with planner behavior.
- `src/plugin/ui/ChatView.ts` - no UI changes.

---

## 8. Acceptance Criteria Checklist

### Phase A: Adapter Construction

- [ ] **A1** - `OllamaAgentPlannerAdapter` implements `IAgentPlannerPort`.
  - It exposes `planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult>`.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::A1_implements_planner_port(vitest)`

- [ ] **A2** - `createAgentPlannerPort('ollama', config)` returns the Ollama planner adapter with trimmed config.
  - Evidence: `tests/sidecar/adapters/createAgentPlannerPort.test.ts::A2_creates_ollama_planner(vitest)`

### Phase B: Ollama Request and Parsing

- [ ] **B1** - The adapter posts to `{baseUrl}/api/chat` with configured model and `stream: false`.
  - The request body includes only prompt/settings/fingerprint metadata needed for planning and no raw vault note content.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B1_posts_ollama_chat_json_request(vitest)` - covers S1

- [ ] **B2** - A valid ready-plan JSON response normalizes to a `RetrievalPlan`.
  - The normalized plan includes topic/task, filters, output intent, planned tool calls, and `stablePlanKey`.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B2_ready_response_normalizes_plan(vitest)` - covers S1

- [ ] **B3** - A valid `needs_scope` JSON response normalizes to `NeedsScopePlan` without search/read tool calls.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B3_needs_scope_response_has_no_tools(vitest)` - covers S2

- [ ] **B4** - Invalid JSON, missing required fields, or grounding-weakening fields fail closed.
  - The adapter returns a typed `needs_scope` result or throws a typed planner error that AGT-4 can turn into insufficient evidence; it does not run retrieval.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B4_invalid_or_unsafe_response_fails_closed(vitest)` - covers S2

### Phase C: Determinism and Contract Reuse

- [ ] **C1** - The Ollama adapter passes the reusable planner contract against deterministic HTTP fixtures.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C1_passes_agent_planner_contract(vitest)` - covers S7

- [ ] **C2** - Equivalent inputs and equivalent fixture responses produce deep-equal normalized plans.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C2_same_fixture_response_same_plan_key(vitest)` - covers S7

- [ ] **C3** - Planner constants remain code constants and are not exposed as plugin settings.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C3_uses_fixed_planner_budgets(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** - **(binding)** Provider-specific planning stays behind `IAgentPlannerPort`.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::A1_implements_planner_port(vitest)` - maps Section 4 Y1 and Section 4b port row

- [ ] **Y2** - **(binding)** Ollama API is the only provider API used by PRV-3.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B1_posts_ollama_chat_json_request(vitest)` - maps Section 4 Y2 and Section 4b adapter row

- [ ] **Y3** - **(binding)** Planner prompts do not include raw note content or secrets.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B1_posts_ollama_chat_json_request(vitest)` - maps Section 4 Y3

- [ ] **Y4** - **(binding)** Adapter output always passes through AGT-2 normalization/validation.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B2_ready_response_normalizes_plan(vitest)` - maps Section 4 Y4

- [ ] **Y5** - **(binding)** Planner budgets are not user-configurable.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C3_uses_fixed_planner_budgets(vitest)` - maps Section 4 Y5

- [ ] **Y6** - **(binding)** Deterministic fixtures produce stable normalized plans.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C2_same_fixture_response_same_plan_key(vitest)` - maps Section 4 Y6

- [ ] **Y7** - **(binding)** `needs_scope` cannot include search/read tool calls.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B3_needs_scope_response_has_no_tools(vitest)` - maps Section 4 Y7

- [ ] **Y8** - **(binding)** PRV-3 does not execute tools, synthesis, or vault writes.
  - Evidence: `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::Y8_no_tool_or_write_surface(vitest)` - maps Section 4 Y8

### Phase Z: Quality Gates

- [ ] **Z1** - `npm run build` passes with zero TypeScript errors in all workspaces.
- [ ] **Z2** - `npm run lint` passes, or only has pre-existing warnings.
- [ ] **Z3** - No `any` types in any new or modified file.
- [ ] **Z4** - All client imports from shared use `@shared/types` alias where applicable; PRV-3 sidecar files should not add client shared imports.
- [ ] **Z5** - Adapter errors include actionable status/model/base URL metadata but no raw prompt, raw note content, or secrets.
- [ ] **Z6** - `/review-story PRV-3` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface.

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::A1_implements_planner_port` | A1, Y1 | S1 | Port shape. |
| 2 | unit | `tests/sidecar/adapters/createAgentPlannerPort.test.ts::A2_creates_ollama_planner` | A2 |  | Factory behavior. |
| 3 | integration | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B1_posts_ollama_chat_json_request` | B1, Y2, Y3 | S1 | Ollama-shaped fetch fixture, not core mock. |
| 4 | integration | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B2_ready_response_normalizes_plan` | B2, Y4 | S1 | Valid ready plan. |
| 5 | integration | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B3_needs_scope_response_has_no_tools` | B3, Y7 | S2 | Valid needs-scope plan. |
| 6 | integration | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::B4_invalid_or_unsafe_response_fails_closed` | B4 | S2 | Invalid JSON and grounding violation. |
| 7 | contract | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C1_passes_agent_planner_contract` | C1 | S7 | Reuses planner contract with HTTP fixture. |
| 8 | integration | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C2_same_fixture_response_same_plan_key` | C2, Y6 | S7 | Stable normalized result. |
| 9 | static | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::C3_uses_fixed_planner_budgets` | C3, Y5 |  | No settings expansion. |
| 10 | static | `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts::Y8_no_tool_or_write_surface` | Y8 | S9 | No tool execution/write imports. |
| 11 | static | `package.json scripts + TypeScript compiler::npm run build` | Z1, Z3 |  | Build/no-`any` quality gate. |
| 12 | static | `eslint.config.mjs::npm run lint` | Z2, Z3, Z5 |  | Lint quality gate. |
| 13 | review | `/review-story PRV-3` | Z6 |  | Required story review gate. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Local Ollama model behavior may not reliably emit strict JSON. | Keep adapter parsing narrow, normalize/fail closed, and test against deterministic Ollama-shaped fixtures. |
| 2 | Prompt changes can affect determinism. | Contract tests assert normalized output stability for identical fixture inputs. |
| 3 | Adapter may be tempted to reuse `IChatPort`, which streams text deltas rather than structured planner JSON. | Create a dedicated planner adapter behind `IAgentPlannerPort`. |
| 4 | Actual token usage may not be consistently available from Ollama. | Preserve any usage fields if available for AGT-6; do not make usage required for PRV-3 acceptance. |

---

## Implementation Order

1. `src/sidecar/adapters/OllamaAgentPlannerAdapter.ts` - implement prompt construction, Ollama request, response parsing, and normalization (covers A1, B1-B4).
2. `src/sidecar/adapters/createAgentPlannerPort.ts` - add sidecar planner factory (covers A2).
3. `tests/sidecar/adapters/OllamaAgentPlannerAdapter.test.ts` - add ready, `needs_scope`, invalid JSON, safety, determinism, and contract tests (covers A1, B1-B4, C1-C3, Y1-Y8).
4. `tests/sidecar/adapters/createAgentPlannerPort.test.ts` - test factory config handling (covers A2).
5. `README.md` - link the PRV-3 backlog row without changing status until implementation completes.
6. **Final verify** - run `npm run build`, `npm run lint`, focused adapter tests, and `/review-story PRV-3` (covers Z1-Z6).

---

*Created: 2026-04-30 | Story: PRV-3 | Epic: 12 - Deterministic agentic note synthesis*
