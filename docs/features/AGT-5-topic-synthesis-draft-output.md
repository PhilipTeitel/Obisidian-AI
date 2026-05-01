# AGT-5: Topic synthesis draft output and prompt-requested formats

**Story**: Convert grounded agent tool results into useful answer or draft-note output that follows prompt-requested formats when feasible, defaults to bullet lists, and exposes traceable contributing sources without writing vault files.
**Epic**: 12 - Deterministic agentic note synthesis (REQ-007)
**Size**: Medium
**Status**: Complete

---

## 1. Summary

AGT-5 makes the agentic workflow useful for topic synthesis. AGT-4 wires planning and tools into chat, but AGT-5 owns the final output contract: how searched/read note content is structured for the provider, how draft-note output is distinguished from ordinary answers, how prompt-requested formats are honored, and how contributing vault sources remain inspectable.

The story should keep the first core iteration draft-only. Generated content is returned through the existing chat stream/result path; it is not written to the vault and does not require a review UI. Default output is a bullet list unless the plan captured a requested format such as a table, outline, report, or meeting summary. The provider may vary prose, but the structure, source set, and grounding must remain stable for deterministic fixtures.

**Linked REQ:** [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md). **Primary ADR:** [ADR-018](../decisions/ADR-018-deterministic-agentic-note-synthesis.md).

**In scope from REQ-007:** S4, S5, S6, S7, and S9.

**Out of scope from REQ-007:**

| Sn | Owner | Why out of scope for AGT-5 |
|----|-------|----------------------------|
| S1 | AGT-2 / AGT-4 | Retrieval planning happens before synthesis formatting. |
| S2 | AGT-2 / AGT-4 | Planning failure behavior is upstream. |
| S3 | AGT-3 / AGT-4 | Multi-step tool execution exists before AGT-5 formats the result. |
| S8 | AGT-6 | Structured runtime logging/token usage is observability work. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`](../decisions/ADR-018-deterministic-agentic-note-synthesis.md) | Defines draft-only synthesis, default bullet-list output, prompt-requested formats, and tiered determinism. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Final synthesis must use only provided vault context and insufficient-evidence behavior. |
| [`docs/decisions/ADR-015-source-provenance-contract.md`](../decisions/ADR-015-source-provenance-contract.md) | Sources must equal notes whose content contributed to the output. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | Synthesis uses existing `IChatPort`; no provider-specific formatting logic belongs in core. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**.
- [x] README, requirements, and ADRs agree that generated output is draft-only and source-grounded.
- [x] Section 4 lists binding synthesis constraints.
- [x] Section 4b lists the final chat provider boundary and confirms no new adapter is introduced.
- [x] Section 8a Test Plan covers every AC ID and implemented REQ-007 scenario.
- [x] REQ-007 S4, S5, S6, S7, and S9 are mapped to tests; out-of-scope Sn IDs are listed in Section 1.
- [x] Phase Y includes evidence that output remains draft-only and source-grounded.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** - Synthesis input comes only from AGT-4/AGT-3 tool results and grounded conversation history; no external sources or raw vault reads are introduced.
2. **Y2** - Prompt-requested output formats captured in `RetrievalPlan.output.requestedFormat` are honored where feasible; otherwise output defaults to bullet lists.
3. **Y3** - Draft-note output is returned in chat/workflow output only; no vault file writes, proposed edit application, or review UI are added.
4. **Y4** - Sources include every note whose content contributes to the final answer/draft and exclude unused or dropped-over-budget content.
5. **Y5** - If retrieved/read context is insufficient, synthesis states the gap instead of fabricating missing facts, activities, or sources.
6. **Y6** - Deterministic fixtures produce the same draft structure and source set for the same prompt/settings/vault state; prose wording may vary only with real providers.
7. **Y7** - Provider message assembly preserves ADR-011 ordering and built-in grounding policy.

---

## 4b. Ports & Adapters

AGT-5 does not introduce a new port or adapter. It consumes existing boundaries:

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IChatPort` | `src/core/ports/IChatPort.ts` | Existing OpenAI/Ollama adapters; recording fake in tests | Existing chat adapter contract/integration tests | Final synthesis still flows through provider-neutral chat completion. |
| `IAgentNoteToolPort` | `src/core/ports/IAgentNoteToolPort.ts` | AGT-3 `AgentNoteToolRunner`; fixture results in synthesis tests | AGT-3 integration tests | AGT-5 consumes tool results; it does not execute storage directly. |

---

## 5. API Endpoints + Schemas

No new route is added. The existing `chat` stream shape remains unchanged.

AGT-5 may add core-only synthesis helpers:

```ts
export interface AgentSynthesisInput {
  plan: RetrievalPlan;
  toolResults: AgentNoteToolResult[];
  messages: ChatMessage[];
  systemPrompt?: string;
  vaultOrganizationPrompt?: string;
}

export interface AgentSynthesisContext {
  retrievalContext: string;
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  outputKind: AgentOutputKind;
  requestedFormat?: string;
}
```

If the implementer adds `draftMarkdown` to an internal `ChatWorkflowResult`, `SidecarRuntime` must keep the public `done` payload stable unless a later UI/API story explicitly changes it.

---

## 6. Frontend Flow

No frontend code is required in AGT-5. The generated answer/draft streams as assistant text in the existing `ChatView`. Source chips use the existing final `sources` list.

### 6a. Component / Data Hierarchy

```text
ChatView
└── existing assistant message stream
    ├── answer output
    └── draft-note markdown output
        └── existing source chips from done.sources
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatView` | unchanged | existing assistant message and source display | Draft output is markdown text in the assistant response. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Existing streaming behavior. |
| Error | Existing transport/provider error behavior. |
| Empty | Existing insufficient-evidence message. |
| Success | Assistant response contains answer or draft markdown; source chips remain available. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/agentSynthesis.ts` | Pure helpers for turning plan/tool results into grounded provider context, source set, and output instructions. |
| 2 | `tests/core/domain/agentSynthesis.test.ts` | Unit tests for default bullet structure, requested formats, source inclusion/exclusion, insufficient context, and no write surface. |
| 3 | `tests/core/workflows/ChatWorkflow.synthesis.test.ts` | Workflow-level tests proving provider messages and final sources use synthesis context. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/ChatWorkflow.ts` | Use synthesis helpers after tool execution to assemble final provider messages and sources. |
| 2 | `src/core/index.ts` | Export synthesis helper types if they are part of core's public test surface. |
| 3 | `tests/integration/ChatWorkflow.grounded-provider.integration.test.ts` | Add or update agentic synthesis grounding-order coverage. |
| 4 | `README.md` | Link AGT-5 from the Epic 12 backlog row. |

### Files UNCHANGED (confirm no modifications needed)

- `src/plugin/ui/ChatView.ts` - no new UI controls or review UI.
- `src/plugin/agent/AgentNoteWriter.ts` - no file writes.
- `src/plugin/vault/ObsidianVaultAccess.ts` - no live vault reads/writes.
- `src/sidecar/adapters/OllamaChatAdapter.ts` and `src/sidecar/adapters/OpenAIChatAdapter.ts` - provider adapters remain provider-neutral.

---

## 8. Acceptance Criteria Checklist

### Phase A: Synthesis Context

- [x] **A1** - `agentSynthesis` helpers produce a grounded retrieval context from tool results only.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::A1_context_uses_tool_results_only(vitest)` - covers S6

- [x] **A2** - Empty or unusable tool context produces an insufficient-context outcome.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::A2_empty_context_reports_gap(vitest)` - covers S6

- [x] **A3** - Source records are deduped by note path in first-use order and exclude dropped-over-budget content.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::A3_sources_match_included_context(vitest)` - covers S5

### Phase B: Output Format

- [x] **B1** - Draft/answer instructions default to bullet lists when no requested format exists.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::B1_defaults_to_bullet_list(vitest)` - covers S4

- [x] **B2** - Requested formats from `RetrievalPlan.output.requestedFormat` are carried into provider instructions.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::B2_requested_format_instructions(vitest)` - covers S4

- [x] **B3** - Draft-note output is clearly marked as draft content but does not add a review UI or write target.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::B3_draft_output_is_chat_only(vitest)` - covers S9

### Phase C: Workflow Integration

- [x] **C1** - `ChatWorkflow` passes synthesis context through `buildGroundedMessages` in ADR-011 order.
  - Evidence: `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C1_provider_messages_include_synthesis_context(vitest)` - covers S6

- [x] **C2** - Final chat result sources equal synthesis sources.
  - Evidence: `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C2_done_sources_equal_synthesis_sources(vitest)` - covers S5, S6

- [x] **C3** - Deterministic planner/tool/chat fakes produce repeatable draft structure and source set.
  - Evidence: `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C3_draft_structure_repeatable(vitest)` - covers S7

### Phase Y: Binding & stack compliance

- [x] **Y1** - **(binding)** Synthesis uses only grounded tool results.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::A1_context_uses_tool_results_only(vitest)` - maps Section 4 Y1

- [x] **Y2** - **(binding)** Requested format is honored where feasible, with bullet-list default.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::B2_requested_format_instructions(vitest)` - maps Section 4 Y2

- [x] **Y3** - **(binding)** Output remains draft-only and chat-only.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::B3_draft_output_is_chat_only(vitest)` - maps Section 4 Y3

- [x] **Y4** - **(binding)** Sources equal contributing synthesis context notes.
  - Evidence: `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C2_done_sources_equal_synthesis_sources(vitest)` - maps Section 4 Y4 and Section 4b chat port row

- [x] **Y5** - **(binding)** Insufficient context cannot fabricate facts or sources.
  - Evidence: `tests/core/domain/agentSynthesis.test.ts::A2_empty_context_reports_gap(vitest)` - maps Section 4 Y5

- [x] **Y6** - **(binding)** Deterministic fixtures preserve draft structure and source set.
  - Evidence: `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C3_draft_structure_repeatable(vitest)` - maps Section 4 Y6

- [x] **Y7** - **(binding)** Grounding message order remains ADR-011 compliant.
  - Evidence: `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C1_provider_messages_include_synthesis_context(vitest)` - maps Section 4 Y7

### Phase Z: Quality Gates

- [x] **Z1** - `npm run build` passes with zero TypeScript errors in all workspaces.
- [x] **Z2** - `npm run lint` passes, or only has pre-existing warnings.
- [x] **Z3** - No `any` types in any new or modified file.
- [x] **Z4** - All client imports from shared use `@shared/types` alias where applicable; AGT-5 core files should not add client shared imports.
- [x] **Z5** - New or modified code includes appropriate trace/log hooks for synthesis outcomes without raw note content; full logging is AGT-6.
- [x] **Z6** - `/review-story AGT-5` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface.

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/agentSynthesis.test.ts::A1_context_uses_tool_results_only` | A1, Y1 | S6 | No external/raw vault sources. |
| 2 | unit | `tests/core/domain/agentSynthesis.test.ts::A2_empty_context_reports_gap` | A2, Y5 | S6 | Insufficient context. |
| 3 | unit | `tests/core/domain/agentSynthesis.test.ts::A3_sources_match_included_context` | A3 | S5 | Dedupe and budget drops. |
| 4 | unit | `tests/core/domain/agentSynthesis.test.ts::B1_defaults_to_bullet_list` | B1 | S4 | Default structure. |
| 5 | unit | `tests/core/domain/agentSynthesis.test.ts::B2_requested_format_instructions` | B2, Y2 | S4 | Prompt-requested format. |
| 6 | static | `tests/core/domain/agentSynthesis.test.ts::B3_draft_output_is_chat_only` | B3, Y3 | S9 | No write/review surface. |
| 7 | unit | `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C1_provider_messages_include_synthesis_context` | C1, Y7 | S6 | ADR-011 order. |
| 8 | unit | `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C2_done_sources_equal_synthesis_sources` | C2, Y4 | S5, S6 | Final sources. |
| 9 | unit | `tests/core/workflows/ChatWorkflow.synthesis.test.ts::C3_draft_structure_repeatable` | C3, Y6 | S7 | Deterministic fakes. |
| 10 | integration | `tests/sidecar/adapters/OpenAIChatAdapter.test.ts::B1_openai_sse_deltas` | Y7 |  | Existing `IChatPort` OpenAI adapter evidence; provider-neutral messages remain upstream. |
| 11 | integration | `tests/sidecar/adapters/OllamaChatAdapter.test.ts::C1_ollama_stream_deltas` | Y7 |  | Existing `IChatPort` Ollama adapter evidence; provider-neutral messages remain upstream. |
| 12 | integration | `tests/integration/agent-note-tools.integration.test.ts::B4_search_notes_uses_searchworkflow_filters_and_hybrid` | Y1, Y4 | S3, S5, S6 | Existing `AgentNoteToolRunner` evidence against SQLite fixture/SearchWorkflow. |
| 13 | integration | `tests/integration/agent-note-tools.integration.test.ts::C3_read_note_filters_and_sources_indexed_nodes` | Y1, Y4 | S3, S5, S6 | Existing `AgentNoteToolRunner` read evidence against SQLite fixture. |
| 14 | static | `package.json scripts + TypeScript compiler::npm run build` | Z1, Z3 |  | Build/no-`any` quality gate. |
| 15 | static | `eslint.config.mjs::npm run lint` | Z2, Z3, Z5 |  | Lint quality gate. |
| 16 | review | `/review-story AGT-5` | Z6 |  | Required story review gate. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Provider prose may vary even with stable context. | Test deterministic fixtures for structure/source stability; allow prose variance per REQ-007. |
| 2 | Draft output could look like a committed vault write. | Label generated content as draft in provider instructions and keep no-write static checks. |
| 3 | Requested formats can be arbitrary. | Treat requested format as an instruction, not a guaranteed parser contract; fallback stays grounded bullet list if infeasible. |
| 4 | Sources can drift if synthesis context is trimmed. | Derive final sources from included context, not from all retrieved/tool results. |

---

## Implementation Order

1. `tests/core/domain/agentSynthesis.test.ts` - write red tests for context-only synthesis, source selection, default bullets, requested formats, insufficient context, and no write surface (covers A1-B3, Y1-Y5).
2. `src/core/domain/agentSynthesis.ts` - implement pure synthesis context and instruction helpers (covers A1-B3).
3. `tests/core/workflows/ChatWorkflow.synthesis.test.ts` - add workflow tests for provider message assembly, final sources, and deterministic structure (covers C1-C3, Y6-Y7).
4. `src/core/workflows/ChatWorkflow.ts` - integrate synthesis helpers after AGT-4 tool execution (covers C1-C3).
5. `src/core/index.ts` - export synthesis helper types if needed by tests/consumers.
6. `README.md` - link AGT-5 row only.
7. **Final verify** - run `npm run build`, `npm run lint`, focused synthesis tests, and `/review-story AGT-5` (covers Z1-Z6).

---

*Created: 2026-04-30 | Story: AGT-5 | Epic: 12 - Deterministic agentic note synthesis*
