# AGT-2: Retrieval plan contract and deterministic plan tests

**Story**: Define the core `RetrievalPlan` contract, planner port, validation/defaulting helpers, and deterministic contract tests that future planner adapters must satisfy before any vector or keyword retrieval runs.
**Epic**: 12 — Deterministic agentic note synthesis (REQ-007)
**Size**: Medium
**Status**: Open

---

## 1. Summary

This story creates the implementation contract for pre-query reasoning without implementing the Ollama planner adapter yet. It defines the structured plan that AGT-4 will consume and PRV-3 must produce: task intent, topic/entities, filters, date scope, output format, planned note tools, and failure/clarification shape for underspecified prompts.

The design goal is deterministic behavior at the planning boundary. For the same user prompt, settings, model configuration identifier, and vault index fingerprint, the normalized plan must be identical. This story therefore focuses on type contracts, plan validation/defaulting, stable ordering, and contract tests. It does not call the vector store, read notes, synthesize draft prose, or invoke Ollama/OpenAI.

This is the dependency that makes the later stories concrete: PRV-3 plugs an Ollama-backed adapter into the planner port, AGT-3 implements the bounded note tools listed by a plan, and AGT-4 wires `ChatWorkflow` into `plan -> tools -> synthesize`.

**Linked REQ:** [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md). **Primary ADR:** [ADR-018](../decisions/ADR-018-deterministic-agentic-note-synthesis.md).

**In scope from REQ-007:** S1, S2, and the retrieval-plan portion of S7.

**Out of scope from REQ-007:**

| Sn | Owner | Why out of scope for AGT-2 |
|----|-------|----------------------------|
| S3 | AGT-3 / AGT-4 | Multi-step tool execution requires bounded note tools and chat-loop wiring. |
| S4 | AGT-3 / AGT-5 | Topic compilation and draft-note assembly happen after a valid plan exists. |
| S5 | AGT-5 | Source traceability on synthesized drafts depends on used-node tracking during synthesis. |
| S6 | AGT-4 / AGT-5 | Final output generation from retrieved results is not implemented here. |
| S8 | AGT-6 | Runtime logging of plan/tool/source/token activity is an observability story. |
| S9 | AGT-3 / later file-writing story | Draft-only behavior is enforced when tools and workflow are wired; file writes remain deferred. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`](../decisions/ADR-018-deterministic-agentic-note-synthesis.md) | Primary ADR: defines pre-query retrieval planning, tiered determinism, draft-only first slice, Ollama-first provider rollout, and fixed testing budgets. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | Planner implementations must remain behind a provider-neutral port; PRV-3 adds the Ollama adapter later. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Planning must preserve the built-in grounding policy and may use `vaultOrganizationPrompt` only as an organizational hint. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Plans express retrieval scope using existing `pathGlobs` and `dateRange` filter shapes. |
| [`docs/decisions/ADR-016-natural-language-date-range-resolution.md`](../decisions/ADR-016-natural-language-date-range-resolution.md) | Explicit natural-language date phrases use existing date resolution rules; AGT-2 adds only the REQ-007 one-week default for date-bounded synthesis when no explicit range exists. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted** (ADR-018, ADR-005, ADR-011, ADR-014, ADR-016)
- [x] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [x] Section 4 lists binding constraints restated from ADR-018 / REQ-007
- [x] Section 4b lists the new planner port and states that no adapter is implemented in this story
- [x] Section 8a Test Plan is filled and every AC ID, including Phase Y and Phase Z, is referenced by at least one planned test row
- [x] The new planner port has a contract test row in Section 8a; no adapter integration test is required until PRV-3 creates the Ollama adapter
- [x] REQ-007 S1, S2, and the retrieval-plan portion of S7 are mapped to test rows; out-of-scope Sn IDs are listed in §1
- [x] Phase Y includes non-mock contract/static evidence that provider logic remains behind a port and that no file-write/tool execution code is introduced

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Planning happens before retrieval. AGT-2 must define a `RetrievalPlan` shape that captures topic/task, filters, output intent, and planned note-tool calls before any vector/keyword search can run.
2. **Y2** — Same prompt/settings/model configuration identifier/vault index fingerprint must normalize to an identical plan representation, including stable ordering of entities, filters, and tool-call plan entries.
3. **Y3** — If a date-bounded synthesis request lacks an explicit `dateRange`, plan normalization applies a one-week default date range relative to an injected anchor date.
4. **Y4** — Vault conventions come from `vaultOrganizationPrompt`; the contract must carry that prompt into planning input but must not treat it as an override of the grounding policy.
5. **Y5** — If the prompt requests a response format, the plan captures that format; otherwise output defaults to bullet lists.
6. **Y6** — Underspecified prompts must produce a non-searchable planning outcome (`status: 'needs_scope'` or equivalent) instead of a broad unconstrained vault search plan.
7. **Y7** — AGT-2 does not implement provider adapters, note-tool execution, retrieval calls, synthesis, file writes, or a review UI.
8. **Y8** — Planner budget values are constants, not plugin settings. Constants are high enough for testing and easy to tune later; token-limit configurability is out of scope.

---

## 4b. Ports & Adapters

This story creates a new port but no adapter. PRV-3 owns the first real adapter (`OllamaAgentPlannerAdapter`) and its integration tests.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IAgentPlannerPort` | `src/core/ports/IAgentPlannerPort.ts` | None in AGT-2 | Contract fixture planner inside `tests/contract/agent-planner.contract.ts` | New provider-neutral port for `planRetrieval(input) -> Promise<AgentPlanResult>`. PRV-3 will bind Ollama behind this port. |

---

## 5. API Endpoints + Schemas

No sidecar message route or HTTP endpoint changes are required in AGT-2. The `chat` route remains unchanged until AGT-4 wires planning into `ChatWorkflow`.

New core contract types should live in `src/core/domain/agentRetrievalPlan.ts` and be re-exported from `src/core/index.ts` if that is the existing public core pattern:

```ts
export type AgentPlanStatus = 'ready' | 'needs_scope';

export type AgentOutputKind = 'answer' | 'draft_note';

export interface AgentDateRange {
  start?: string; // ISO YYYY-MM-DD
  end?: string;   // ISO YYYY-MM-DD
  defaulted?: boolean;
}

export interface AgentPlanInput {
  userPrompt: string;
  conversation: ChatMessage[];
  vaultOrganizationPrompt?: string;
  explicitPathGlobs?: string[];
  explicitDateRange?: { start?: string; end?: string };
  dailyNotePathGlobs?: string[];
  anchorDate: string; // ISO YYYY-MM-DD, injected for determinism
  modelConfigId: string;
  vaultIndexFingerprint: string;
}

export interface AgentToolCallPlan {
  id: string;
  type: 'search_notes' | 'read_note' | 'assemble_draft';
  reason: string;
  query?: string;
  pathGlobs?: string[];
  dateRange?: AgentDateRange;
}

export interface RetrievalPlan {
  planVersion: 'v1';
  status: 'ready';
  task: string;
  topic: string;
  entities: string[];
  filters: {
    pathGlobs?: string[];
    dateRange?: AgentDateRange;
    tags?: string[];
  };
  output: {
    kind: AgentOutputKind;
    requestedFormat?: string;
    defaultFormat: 'bullet_list';
  };
  toolCalls: AgentToolCallPlan[];
  stablePlanKey: string;
}

export interface NeedsScopePlan {
  planVersion: 'v1';
  status: 'needs_scope';
  reason: string;
  missing: Array<'topic' | 'scope' | 'output'>;
  stablePlanKey: string;
}

export type AgentPlanResult = RetrievalPlan | NeedsScopePlan;
```

New port:

```ts
export interface IAgentPlannerPort {
  planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult>;
}
```

The exact field names may be adjusted by the implementer if TypeScript ergonomics require it, but the story must preserve the semantics above and the test names in §8a.

---

## 6. Frontend Flow

Frontend work is not applicable for AGT-2. No UI or plugin settings are changed in this story.

### 6a. Component / Data Hierarchy

```
ChatView (unchanged in AGT-2)
└── future AGT-4 chat submit
    └── ChatWorkflow
        └── IAgentPlannerPort.planRetrieval(input)
            └── RetrievalPlan contract from AGT-2
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| N/A | N/A | N/A | AGT-2 is core contract work only. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| N/A | No user-facing state changes in AGT-2. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/agentRetrievalPlan.ts` | Plan/result types, validation/defaulting helpers, stable normalization / `stablePlanKey` helper, and AGT-2 constants. |
| 2 | `src/core/ports/IAgentPlannerPort.ts` | Provider-neutral planner port consumed by AGT-4 and implemented by PRV-3. |
| 3 | `tests/core/domain/agentRetrievalPlan.test.ts` | Unit tests for normalization, one-week default, bullet-list default, requested format capture, needs-scope validation, stable ordering/key. |
| 4 | `tests/contract/agent-planner.contract.ts` | Contract suite any `IAgentPlannerPort` adapter must pass; uses a deterministic fixture planner in AGT-2 and is reused by PRV-3. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/index.ts` | Export `agentRetrievalPlan` types/helpers and `IAgentPlannerPort` if core exports ports from this index. |
| 2 | `src/core/ports/index.ts` | Export `IAgentPlannerPort`. |
| 3 | `README.md` | Already links AGT-2 from Epic 12; implementer should leave the backlog row status unchanged until implementation is complete. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/workflows/ChatWorkflow.ts` — AGT-4 wires the planner into chat; AGT-2 only defines the contract.
- `src/sidecar/adapters/OllamaChatAdapter.ts` — PRV-3 owns the Ollama planner adapter.
- `src/plugin/ui/ChatView.ts` — no user-visible behavior until AGT-4.
- `src/plugin/settings/SettingsTab.ts` — no new settings; budgets are constants in code for now.
- `src/plugin/agent/AgentNoteWriter.ts` — file writing is out of scope for the REQ-007 first slice.

---

## 8. Acceptance Criteria Checklist

### Phase A: Plan Contract Types

- [ ] **A1** — `AgentPlanInput`, `RetrievalPlan`, `NeedsScopePlan`, `AgentToolCallPlan`, and `AgentPlanResult` are defined in core with no infrastructure imports.
  - The types include `vaultOrganizationPrompt`, explicit path/date scope, `anchorDate`, `modelConfigId`, and `vaultIndexFingerprint`.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::A1_exports_plan_contract_shapes(vitest)`

- [ ] **A2** — A ready plan includes task/topic, entities, filters, output intent, planned note-tool calls, `planVersion: 'v1'`, and `stablePlanKey`.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::A2_ready_plan_has_required_fields(vitest)` — covers S1.

- [ ] **A3** — A needs-scope plan includes `status: 'needs_scope'`, a human-usable reason, missing fields, `planVersion: 'v1'`, and `stablePlanKey`; it contains no `search_notes` tool call.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::A3_needs_scope_plan_is_not_searchable(vitest)` — covers S2.

### Phase B: Deterministic Normalization and Defaults

- [ ] **B1** — Normalizing equivalent plans sorts/deduplicates entities, tags, path globs, and tool calls into stable order without changing semantics.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B1_normalization_stable_order(vitest)` — covers S7.

- [ ] **B2** — Same prompt/settings/modelConfigId/vaultIndexFingerprint/anchorDate produce the same `stablePlanKey` and normalized plan on repeated runs.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B2_same_inputs_same_plan_key(vitest)` — covers S7.

- [ ] **B3** — A date-bounded synthesis plan with no explicit `dateRange` defaults to one week: `[anchorDate - 6 days, anchorDate]`, with `dateRange.defaulted === true`.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B3_date_bounded_defaults_to_one_week(vitest)` — covers S1.

- [ ] **B4** — Explicit `dateRange` from input is preserved and is not overwritten by the one-week default.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B4_explicit_date_range_wins(vitest)` — covers S1.

- [ ] **B5** — Prompt-requested output format is captured in `output.requestedFormat`; when omitted, `output.defaultFormat` is `bullet_list`.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B5_output_format_defaults_to_bullets(vitest)` — covers S1.

- [ ] **B6** — `vaultOrganizationPrompt` is part of `AgentPlanInput` and can influence filter/output metadata, but validation rejects plans that try to weaken grounding or mark off-vault sources as allowed.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B6_vault_org_prompt_does_not_override_grounding(vitest)` — covers S1.

### Phase C: Planner Port Contract

- [ ] **C1** — `IAgentPlannerPort.planRetrieval` is declared as a provider-neutral port returning `Promise<AgentPlanResult>`.
  - Evidence: `tests/contract/agent-planner.contract.ts::C1_port_contract_signature(vitest)`

- [ ] **C2** — The generic planner contract asserts ready-plan determinism using a fixture planner: repeated calls with identical `AgentPlanInput` produce deep-equal normalized plans.
  - Evidence: `tests/contract/agent-planner.contract.ts::C2_contract_ready_plan_deterministic(vitest)` — covers S7.

- [ ] **C3** — The generic planner contract asserts underspecified prompts produce `needs_scope` and no planned search/read tool calls.
  - Evidence: `tests/contract/agent-planner.contract.ts::C3_contract_needs_scope_no_search(vitest)` — covers S2.

- [ ] **C4** — The generic planner contract asserts all ready plans contain at least one `search_notes` tool call and no file-write tool calls.
  - Evidence: `tests/contract/agent-planner.contract.ts::C4_contract_ready_plan_search_only_tools(vitest)` — covers S1.

### Phase Y: Binding & Stack Compliance

- [ ] **Y1** — **(binding)** Planning contract exists before retrieval and includes task/topic, filters, output intent, and planned note-tool calls.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::A2_ready_plan_has_required_fields(vitest)` — maps §4 Y1.

- [ ] **Y2** — **(binding)** Stable normalization produces identical plans and keys for identical inputs.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B2_same_inputs_same_plan_key(vitest)` — maps §4 Y2.

- [ ] **Y3** — **(binding)** One-week default is applied only for date-bounded synthesis without an explicit date range.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B3_date_bounded_defaults_to_one_week(vitest)` — maps §4 Y3.

- [ ] **Y4** — **(binding)** `vaultOrganizationPrompt` is accepted as planning input but cannot override vault-only grounding.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B6_vault_org_prompt_does_not_override_grounding(vitest)` — maps §4 Y4.

- [ ] **Y5** — **(binding)** Output defaults to bullet lists unless a requested format is present.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::B5_output_format_defaults_to_bullets(vitest)` — maps §4 Y5.

- [ ] **Y6** — **(binding)** Underspecified prompts cannot become broad unconstrained search plans.
  - Evidence: `tests/contract/agent-planner.contract.ts::C3_contract_needs_scope_no_search(vitest)` — maps §4 Y6.

- [ ] **Y7** — **(binding)** AGT-2 introduces no provider adapter, note-tool execution, retrieval call, synthesis, file write, or review UI.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::Y7_no_runtime_tool_or_file_write_surface(vitest)` plus static review of file touchpoints — maps §4 Y7.

- [ ] **Y8** — **(binding)** Planner budgets are fixed constants in `agentRetrievalPlan.ts`, not plugin settings.
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::Y8_budget_constants_not_settings(vitest)` — maps §4 Y8.

- [ ] **Y9** — **(binding)** The new planner port has a reusable contract suite for future adapters.
  - Evidence: `tests/contract/agent-planner.contract.ts::C2_contract_ready_plan_deterministic(vitest)` — maps §4b.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file
  - Evidence: `rg "\\bany\\b" src/core/domain/agentRetrievalPlan.ts src/core/ports/IAgentPlannerPort.ts tests/core/domain/agentRetrievalPlan.test.ts tests/contract/agent-planner.contract.ts`

- [ ] **Z4** — All core exports follow existing project import/export conventions
  - Evidence: `npm run typecheck`

- [ ] **Z5** — New or modified code includes appropriate logging hooks or explicitly avoids logging because AGT-2 is pure contract work
  - Evidence: `tests/core/domain/agentRetrievalPlan.test.ts::Z5_no_raw_prompt_or_note_content_required_for_plan_key(vitest)`

- [ ] **Z6** — `/review-story AGT-2` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface
  - Evidence: `/review-story AGT-2`

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::A1_exports_plan_contract_shapes` | A1 | S1 | Type/runtime fixture shape checks. |
| 2 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::A2_ready_plan_has_required_fields` | A2, Y1 | S1 | Verifies plan captures required pre-query fields. |
| 3 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::A3_needs_scope_plan_is_not_searchable` | A3 | S2 | No broad search when scope missing. |
| 4 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::B1_normalization_stable_order` | B1 | S7 | Stable sort/dedupe. |
| 5 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::B2_same_inputs_same_plan_key` | B2, Y2 | S7 | Same inputs, same plan/key. |
| 6 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::B3_date_bounded_defaults_to_one_week` | B3, Y3 | S1 | One-week default. |
| 7 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::B4_explicit_date_range_wins` | B4 | S1 | Explicit scope preserved. |
| 8 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::B5_output_format_defaults_to_bullets` | B5, Y5 | S1 | Prompt format vs default bullets. |
| 9 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::B6_vault_org_prompt_does_not_override_grounding` | B6, Y4 | S1 | Organization prompt is a hint only. |
| 10 | contract | `tests/contract/agent-planner.contract.ts::C1_port_contract_signature` | C1 | — | Port contract exists. |
| 11 | contract | `tests/contract/agent-planner.contract.ts::C2_contract_ready_plan_deterministic` | C2, Y9 | S7 | Reusable for PRV-3. |
| 12 | contract | `tests/contract/agent-planner.contract.ts::C3_contract_needs_scope_no_search` | C3, Y6 | S2 | No broad search. |
| 13 | contract | `tests/contract/agent-planner.contract.ts::C4_contract_ready_plan_search_only_tools` | C4 | S1 | Allows search/read/draft planning, no file write. |
| 14 | unit/static | `tests/core/domain/agentRetrievalPlan.test.ts::Y7_no_runtime_tool_or_file_write_surface` | Y7 | S9 out of scope | Guards story boundary. |
| 15 | unit/static | `tests/core/domain/agentRetrievalPlan.test.ts::Y8_budget_constants_not_settings` | Y8 | — | Budget constants only. |
| 16 | static | `rg "\\bany\\b" ...` | Z3 | — | No `any`. |
| 17 | typecheck | `npm run typecheck` | Z4 | — | Export/import correctness. |
| 18 | unit | `tests/core/domain/agentRetrievalPlan.test.ts::Z5_no_raw_prompt_or_note_content_required_for_plan_key` | Z5 | — | Plan key avoids logging/storing raw content. |
| 19 | build | `npm run build` | Z1 | — | Quality gate. |
| 20 | lint | `npm run lint` | Z2 | — | Quality gate. |
| 21 | review | `/review-story AGT-2` | Z6 | — | Story review gate. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Over-specifying the plan shape before seeing Ollama output may make PRV-3 awkward. | Keep the contract semantic rather than provider-specific; allow field-name adjustments while preserving acceptance tests. |
| 2 | A pure contract story does not make the plugin visibly better yet. | Explicitly position AGT-2 as dependency for PRV-3 and AGT-4; no UI claim in this story. |
| 3 | `stablePlanKey` could leak raw prompts if implemented naively. | Require normalized/hashing helper tests and no raw note content in the key/log-safe shape. |
| 4 | Needs-scope behavior could become too conservative. | AGT-2 only defines the safe failure shape; PRV-3/AGT-4 can tune planner prompts while preserving no-broad-search behavior. |

---

## Implementation Order

1. `src/core/domain/agentRetrievalPlan.ts` — define plan/result/tool-call types, constants, normalization helpers, one-week default helper, and `stablePlanKey` helper (covers A1–B5, Y1–Y5, Y8).
2. `tests/core/domain/agentRetrievalPlan.test.ts` — add red-first unit tests for type fixtures, defaults, stable normalization, needs-scope validation, no runtime/file-write surface, and no raw-content plan key (covers A1–B6, Y1–Y8, Z5).
3. `src/core/ports/IAgentPlannerPort.ts` and `src/core/ports/index.ts` — add provider-neutral planner port and exports (covers C1, Y9).
4. `tests/contract/agent-planner.contract.ts` — create reusable planner contract suite with an AGT-2 deterministic fixture planner (covers C1–C4, Y6, Y9).
5. `src/core/index.ts` — re-export the new domain and port contracts if required by existing package conventions (covers Z4).
6. **Verify** — run targeted tests: `npx vitest run tests/core/domain/agentRetrievalPlan.test.ts tests/contract/agent-planner.contract.ts`.
7. **Final verify** — run `npm run build`, `npm run lint`, and `npm run typecheck`; then run `/review-story AGT-2`.

---

*Created: 2026-04-30 | Story: AGT-2 | Epic: 12 — Deterministic agentic note synthesis (REQ-007)*
