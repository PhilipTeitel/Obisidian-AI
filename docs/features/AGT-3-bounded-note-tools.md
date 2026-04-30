# AGT-3: Bounded note tools for search, note read, and draft assembly

**Story**: Implement a bounded core note-tool runner that executes `search_notes`, `read_note`, and `assemble_draft` plan steps by delegating to existing retrieval and store boundaries, returning draft-only output with traceable source records and no vault writes.
**Epic**: 12 - Deterministic agentic note synthesis (REQ-007)
**Size**: Large
**Status**: Complete

---

## 1. Summary

AGT-3 provides the deterministic tool substrate that later lets `ChatWorkflow` run `plan -> tools -> synthesize`. AGT-2 already defines the retrieval plan contract and planned tool-call names. This story turns those names into a bounded executor with stable request/result types, fixed budgets, and tests that prove the runner calls `SearchWorkflow` and `IDocumentStore` instead of bypassing existing retrieval, filtering, grounding, and provenance rules.

The first tool surface is intentionally narrow: `search_notes` delegates to `runSearch`, `read_note` reads indexed note nodes from `IDocumentStore`, and `assemble_draft` combines prior tool outputs into a draft-only markdown payload. It does not call an LLM for final prose, does not wire into `ChatWorkflow`, and does not write or modify vault files.

**Linked REQ:** [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md). **Primary ADR:** [ADR-018](../decisions/ADR-018-deterministic-agentic-note-synthesis.md).

**In scope from REQ-007:** S3, the tool-substrate portion of S4, and S9.

**Out of scope from REQ-007:**

| Sn | Owner | Why out of scope for AGT-3 |
|----|-------|----------------------------|
| S1 | AGT-2 / AGT-4 | Retrieval planning already exists; ChatWorkflow wiring happens later. |
| S2 | AGT-2 / AGT-4 | Planning failure behavior is handled before tools are run. |
| S5 | AGT-5 | Final draft provenance presentation belongs with synthesis output. AGT-3 only carries source records forward. |
| S6 | AGT-4 / AGT-5 | Final response generation from tool results is not implemented here. |
| S7 | AGT-2 / AGT-4 | Plan determinism exists; full source-set stability is proven when the workflow loop is wired. |
| S8 | AGT-6 | Full retrieval-plan/tool/token observability is a later logging story. AGT-3 may expose trace fields for AGT-6. |

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`](../decisions/ADR-018-deterministic-agentic-note-synthesis.md) | Primary ADR: bounded tools, draft-only output, fixed budgets, no arbitrary autonomy, and no vault writes. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Tools must operate only over indexed vault content and cannot introduce external sources. |
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | `search_notes` must reuse `SearchWorkflow` so hybrid retrieval, coarse-K, and fallback behavior remain consistent. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Tool calls must preserve plan-derived `pathGlobs`, `dateRange`, and tag filters. |
| [`docs/decisions/ADR-015-source-provenance-contract.md`](../decisions/ADR-015-source-provenance-contract.md) | Tool results must carry source records only for note content actually searched/read/assembled. |
| [`docs/decisions/ADR-016-natural-language-date-range-resolution.md`](../decisions/ADR-016-natural-language-date-range-resolution.md) | AGT-3 consumes already-resolved date scopes and must not reinterpret date phrases differently. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**.
- [x] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries.
- [x] Section 4 (Binding constraints) is filled with constraints from REQ-007 and ADR-018.
- [x] Section 4b (Ports & Adapters) lists the new tool port and implementation boundary.
- [x] Section 8a (Test Plan) is filled and every AC ID, including Phase Y and Phase Z, is referenced by at least one planned test row.
- [x] The new tool port has a contract test row, and the concrete tool runner has integration rows against hermetic `SearchWorkflow` / SQLite-backed store fixtures.
- [x] REQ-007 S3, S4, and S9 are mapped to test rows; out-of-scope Sn IDs are listed in Section 1.
- [x] Phase Y includes non-mock evidence for the tool runner delegating to real workflow/store boundaries and never using vault-write surfaces.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** - Tool execution is bounded by fixed code constants for tool steps, search result count, read-node count, and draft source budget. These are not plugin settings.
2. **Y2** - `search_notes` delegates to `SearchWorkflow.runSearch`; it must not implement a parallel vector, FTS, filter, or ranking path.
3. **Y3** - `read_note` reads only indexed vault nodes through `IDocumentStore`; it must not use Obsidian vault APIs, filesystem reads, or external sources.
4. **Y4** - `assemble_draft` returns draft content in memory only. AGT-3 must not call `AgentNoteWriter`, `IVaultAccessPort`, `Vault.create`, `Vault.modify`, `fs.writeFile`, or equivalent file-write APIs.
5. **Y5** - Tool calls preserve plan-derived `pathGlobs`, `dateRange`, tags, and requested output intent; AGT-3 must not broaden scope when a tool call omits its own filters.
6. **Y6** - Tool results are deterministic for equivalent inputs and fixture store state: stable result ordering, stable source ordering, stable trace IDs, and stable budget-exceeded status.
7. **Y7** - Tool results carry source records for searched/read/assembled note content and exclude unavailable, filtered-out, or over-budget content.
8. **Y8** - Unknown tool names, unsupported write-like tool names, missing read targets, and budget exhaustion fail closed with typed errors/statuses rather than broad fallback searches or writes.

---

## 4b. Ports & Adapters

AGT-3 creates one new provider-neutral tool port and one core runner implementation. It consumes existing retrieval/store/embedder ports but does not change their contracts.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IAgentNoteToolPort` | `src/core/ports/IAgentNoteToolPort.ts` | `AgentNoteToolRunner` (`src/core/workflows/AgentNoteToolRunner.ts`) | `SearchWorkflow` plus `IDocumentStore` / `IEmbeddingPort`; integration tests use hermetic SQLite/search fixtures | New core boundary for executing one planned note tool at a time and returning typed results/traces. |

Existing ports consumed but not modified:

- `IDocumentStore` (`src/core/ports/IDocumentStore.ts`) - used for indexed note reads and metadata lookup.
- `IEmbeddingPort` (`src/core/ports/IEmbeddingPort.ts`) - passed through to `SearchWorkflow` for `search_notes`.

---

## 5. API Endpoints + Schemas

No sidecar message route, HTTP endpoint, or plugin wire schema changes are required in AGT-3. `ChatWorkflow` integration is deferred to AGT-4.

New core contracts should live in `src/core/domain/agentNoteTools.ts` and be exported from `src/core/index.ts`:

```ts
import type {
  AgentToolCallPlan,
  RetrievalPlan,
} from './agentRetrievalPlan.js';
import type {
  SearchAssemblyOptions,
  SearchResult,
  Source,
  UsedNodeRecord,
} from './types.js';

export const AGENT_NOTE_TOOL_BUDGETS = {
  maxToolSteps: 8,
  maxSearchResults: 12,
  maxReadNodes: 40,
  maxDraftSourceTokens: 6000,
} as const;

export type AgentNoteToolName = 'search_notes' | 'read_note' | 'assemble_draft';

export type AgentNoteToolStatus =
  | 'ok'
  | 'skipped'
  | 'needs_target'
  | 'budget_exceeded'
  | 'unsupported_tool';

export interface AgentNoteToolRunInput {
  plan: RetrievalPlan;
  toolCall: AgentToolCallPlan;
  priorResults: AgentNoteToolResult[];
  search?: SearchAssemblyOptions;
  apiKey?: string;
  coarseK?: number;
  k?: number;
  enableHybridSearch?: boolean;
}

export interface AgentSearchToolResult {
  type: 'search_notes';
  status: AgentNoteToolStatus;
  results: SearchResult[];
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  trace: AgentNoteToolTrace;
}

export interface AgentReadToolResult {
  type: 'read_note';
  status: AgentNoteToolStatus;
  notePath?: string;
  nodes: AgentReadNode[];
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  trace: AgentNoteToolTrace;
}

export interface AgentDraftToolResult {
  type: 'assemble_draft';
  status: AgentNoteToolStatus;
  draftMarkdown: string;
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  trace: AgentNoteToolTrace;
}

export type AgentNoteToolResult =
  | AgentSearchToolResult
  | AgentReadToolResult
  | AgentDraftToolResult;
```

The implementer may adjust field names for TypeScript ergonomics, but must preserve the semantics above: typed tool inputs/results, bounded execution, source records, no vault writes, and no new sidecar/plugin wire route.

---

## 6. Frontend Flow

Frontend work is not applicable for AGT-3. No UI, settings, commands, or chat-pane states change in this story.

### 6a. Component / Data Hierarchy

```text
ChatView (unchanged in AGT-3)
└── future AGT-4 chat submit
    └── ChatWorkflow
        └── IAgentNoteToolPort.runTool(input)
            ├── search_notes -> SearchWorkflow.runSearch
            ├── read_note -> IDocumentStore indexed nodes
            └── assemble_draft -> in-memory draft result
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| N/A | N/A | N/A | AGT-3 is core workflow and contract work only. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| N/A | No user-facing state changes in AGT-3. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/agentNoteTools.ts` | Tool result types, budget constants, target resolution helpers, source/used-node normalization helpers, and typed error/status helpers. |
| 2 | `src/core/ports/IAgentNoteToolPort.ts` | Provider-neutral tool runner port consumed by AGT-4. |
| 3 | `src/core/workflows/AgentNoteToolRunner.ts` | Concrete bounded runner delegating to `runSearch` and `IDocumentStore`. |
| 4 | `tests/core/domain/agentNoteTools.test.ts` | Unit tests for budgets, stable ordering, source normalization, missing-target handling, and write-tool rejection. |
| 5 | `tests/contract/agent-note-tools.contract.ts` | Reusable contract suite for `IAgentNoteToolPort`. |
| 6 | `tests/core/workflows/AgentNoteToolRunner.test.ts` | Unit-level runner tests using existing test doubles. |
| 7 | `tests/integration/agent-note-tools.integration.test.ts` | Integration coverage against `SearchWorkflow` and a hermetic store fixture, including SQLite-backed read/search behavior where practical. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/agentRetrievalPlan.ts` | Add optional read-target fields to `AgentToolCallPlan` if needed, such as `notePath`, `nodeIds`, or `fromPreviousSearchResultIds`, while preserving AGT-2 semantics. |
| 2 | `src/core/index.ts` | Export `agentNoteTools` types/helpers and `IAgentNoteToolPort`. |
| 3 | `src/core/ports/index.ts` | Export `IAgentNoteToolPort`. |
| 4 | `vitest.config.ts` | Include the new reusable contract test file if contract tests are explicitly listed. |
| 5 | `tests/core/workflows/searchTestStore.ts` | Make the existing store test double honor `getNodesByNote` for runner unit tests. |
| 6 | `README.md` | Link AGT-3 from the Epic 12 backlog row; leave status as `Not Started` until implementation completes. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/workflows/ChatWorkflow.ts` - AGT-4 owns workflow-loop integration.
- `src/sidecar/runtime/SidecarRuntime.ts` - no sidecar route changes in AGT-3.
- `src/plugin/ui/ChatView.ts` - no UI behavior changes in AGT-3.
- `src/plugin/agent/AgentNoteWriter.ts` - file writing is explicitly out of scope.
- `src/plugin/vault/ObsidianVaultAccess.ts` - tools read indexed content via `IDocumentStore`, not live vault files.
- `src/sidecar/adapters/OllamaChatAdapter.ts` and `src/sidecar/adapters/OpenAIChatAdapter.ts` - provider synthesis and planner adapters are later stories.

---

## 8. Acceptance Criteria Checklist

### Phase A: Tool Contracts and Budgets

- [x] **A1** - Core note-tool contracts exist with typed request/result/trace shapes.
  - `src/core/domain/agentNoteTools.ts` defines `AgentNoteToolRunInput`, `AgentNoteToolResult`, per-tool result variants, source records, used-node records, and typed statuses/errors.
  - Evidence: `tests/core/domain/agentNoteTools.test.ts::A1_exports_tool_contract_shapes(vitest)`

- [x] **A2** - Fixed tool budgets are code constants, not plugin settings.
  - Budgets include max tool steps, max search results, max read nodes, and max draft source budget; no new settings are added.
  - Evidence: `tests/core/domain/agentNoteTools.test.ts::A2_budget_constants_not_settings(vitest)`

- [x] **A3** - The `IAgentNoteToolPort` contract runs one planned tool call and returns a typed result.
  - The port accepts `AgentNoteToolRunInput` and returns `Promise<AgentNoteToolResult>`.
  - Evidence: `tests/contract/agent-note-tools.contract.ts::A3_port_contract_signature(vitest)`

- [x] **A4** - Unsupported or write-like tools fail closed.
  - Unknown tool names and write-like names such as `write_note`, `create_file`, or `modify_note` return/throw typed unsupported-tool outcomes and do not execute search/read/draft logic.
  - Evidence: `tests/core/domain/agentNoteTools.test.ts::A4_rejects_unsupported_write_like_tools(vitest)` - covers S9

### Phase B: `search_notes`

- [x] **B1** - `search_notes` delegates to `runSearch` with the planned query and inherited filters.
  - The runner passes plan/tool `query`, `pathGlobs`, `dateRange`, `tags`, `coarseK`, `k`, `enableHybridSearch`, and assembly options through to `SearchWorkflow`.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::B1_search_notes_delegates_to_search_workflow(vitest)` - covers S3

- [x] **B2** - `search_notes` does not broaden scope when tool-level filters are omitted.
  - Missing tool-level filters inherit plan filters; an empty tool-level scope never clears a narrower plan scope.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::B2_search_inherits_plan_scope(vitest)` - covers S3

- [x] **B3** - `search_notes` returns stable, bounded search results and source records.
  - Results are capped by budget, ordered deterministically, and sources follow first-use order with note-level dedupe.
  - Evidence: `tests/contract/agent-note-tools.contract.ts::B3_contract_search_results_stable_and_bounded(vitest)` - covers S3

- [x] **B4** - `search_notes` uses the existing hybrid/filter retrieval behavior in integration.
  - The integration test proves vector, keyword, path/date filters, and content fallback remain owned by `SearchWorkflow` / store fixtures rather than a new parallel search implementation.
  - Evidence: `tests/integration/agent-note-tools.integration.test.ts::B4_search_notes_uses_searchworkflow_filters_and_hybrid(vitest)` - covers S3

### Phase C: `read_note`

- [x] **C1** - `read_note` reads indexed note content through `IDocumentStore`.
  - Read targets may come from explicit `notePath`/`nodeIds` fields or prior `search_notes` results; reads never use Obsidian APIs or filesystem APIs.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::C1_read_note_uses_document_store(vitest)` - covers S3

- [x] **C2** - `read_note` fails closed when no target can be resolved.
  - Missing explicit targets and missing prior search targets produce `needs_target` without broad search, whole-vault read, or file access.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::C2_read_note_missing_target_fails_closed(vitest)` - covers S3

- [x] **C3** - `read_note` preserves filters, budgets, and source provenance.
  - Filtered-out, missing, duplicate, and over-budget nodes are excluded from returned content and source records.
  - Evidence: `tests/integration/agent-note-tools.integration.test.ts::C3_read_note_filters_and_sources_indexed_nodes(vitest)` - covers S3

### Phase D: `assemble_draft`

- [x] **D1** - `assemble_draft` creates an in-memory draft from prior tool results.
  - The draft combines searched/read indexed content into markdown with source records and no provider call.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::D1_assemble_draft_uses_prior_tool_outputs(vitest)` - covers S4

- [x] **D2** - `assemble_draft` is draft-only and performs no vault writes.
  - Static and runtime tests prove no use of `AgentNoteWriter`, `IVaultAccessPort`, Obsidian `Vault.create`/`modify`, or Node file-write APIs.
  - Evidence: `tests/core/domain/agentNoteTools.test.ts::D2_assemble_draft_has_no_write_surface(vitest)` - covers S9

- [x] **D3** - `assemble_draft` preserves requested output intent without owning final synthesis.
  - The result carries plan output metadata (`answer` vs `draft_note`, requested format, default bullet-list format) for AGT-5, but does not attempt final LLM prose generation.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::D3_assemble_draft_carries_output_intent(vitest)` - covers S4

### Phase E: Runner Sequencing and Traceability

- [x] **E1** - The runner produces stable trace records for each tool call.
  - Trace records include plan key, tool call ID, tool type, status, counts, budget flags, and source counts without raw note content.
  - Evidence: `tests/contract/agent-note-tools.contract.ts::E1_contract_trace_records_are_stable(vitest)` - covers S3

- [x] **E2** - Budget exhaustion stops the current tool without executing unsafe fallback behavior.
  - Over-budget searches/reads/drafts return `budget_exceeded` and preserve already-collected source records without broadening scope or writing files.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::E2_budget_exhaustion_fails_closed(vitest)` - covers S3, S9

### Phase Y: Binding & stack compliance

- [x] **Y1** - **(binding)** Tool budgets are fixed constants and not plugin settings.
  - Evidence: `tests/core/domain/agentNoteTools.test.ts::A2_budget_constants_not_settings(vitest)` - maps Section 4 Y1

- [x] **Y2** - **(binding)** `search_notes` delegates to `SearchWorkflow.runSearch`.
  - Evidence: `tests/integration/agent-note-tools.integration.test.ts::B4_search_notes_uses_searchworkflow_filters_and_hybrid(vitest)` - maps Section 4 Y2 and Section 4b adapter row

- [x] **Y3** - **(binding)** `read_note` uses indexed store content only.
  - Evidence: `tests/integration/agent-note-tools.integration.test.ts::C3_read_note_filters_and_sources_indexed_nodes(vitest)` - maps Section 4 Y3

- [x] **Y4** - **(binding)** Draft assembly has no vault-write surface.
  - Evidence: `tests/core/domain/agentNoteTools.test.ts::D2_assemble_draft_has_no_write_surface(vitest)` - maps Section 4 Y4

- [x] **Y5** - **(binding)** Plan-derived scope cannot be broadened by tool execution.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::B2_search_inherits_plan_scope(vitest)` - maps Section 4 Y5

- [x] **Y6** - **(binding)** Equivalent inputs produce stable results and traces.
  - Evidence: `tests/contract/agent-note-tools.contract.ts::E1_contract_trace_records_are_stable(vitest)` - maps Section 4 Y6 and Section 4b port row

- [x] **Y7** - **(binding)** Sources only represent searched/read/assembled indexed content.
  - Evidence: `tests/integration/agent-note-tools.integration.test.ts::C3_read_note_filters_and_sources_indexed_nodes(vitest)` - maps Section 4 Y7

- [x] **Y8** - **(binding)** Unknown, write-like, missing-target, and budget-exceeded paths fail closed.
  - Evidence: `tests/core/workflows/AgentNoteToolRunner.test.ts::E2_budget_exhaustion_fails_closed(vitest)` and `tests/core/domain/agentNoteTools.test.ts::A4_rejects_unsupported_write_like_tools(vitest)` - maps Section 4 Y8

### Phase Z: Quality Gates

- [x] **Z1** - `npm run build` passes with zero TypeScript errors in all workspaces.
- [x] **Z2** - `npm run lint` passes, or only has pre-existing warnings.
- [x] **Z3** - No `any` types in any new or modified file.
- [x] **Z4** - All client imports from shared use `@shared/types` alias where applicable; AGT-3 core-only files should not introduce client shared imports.
- [x] **Z5** - New or modified code includes appropriate logging/trace fields for errors and significant operations without raw note content.
- [x] **Z6** - `/review-story AGT-3` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface.

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/agentNoteTools.test.ts::A1_exports_tool_contract_shapes` | A1 | S3 | Type/shape test for request, result, trace, and source contracts. |
| 2 | unit | `tests/core/domain/agentNoteTools.test.ts::A2_budget_constants_not_settings` | A2, Y1, Z4 | S3 | Proves fixed constants and no settings surface expansion. |
| 3 | contract | `tests/contract/agent-note-tools.contract.ts::A3_port_contract_signature` | A3 | S3 | Reusable contract for `IAgentNoteToolPort`. |
| 4 | unit | `tests/core/domain/agentNoteTools.test.ts::A4_rejects_unsupported_write_like_tools` | A4, Y8 | S9 | Unsupported/write-like names fail closed. |
| 5 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::B1_search_notes_delegates_to_search_workflow` | B1 | S3 | Delegation with planned query and options. |
| 6 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::B2_search_inherits_plan_scope` | B2, Y5 | S3 | Tool execution cannot clear narrower plan scope. |
| 7 | contract | `tests/contract/agent-note-tools.contract.ts::B3_contract_search_results_stable_and_bounded` | B3 | S3 | Stable bounded search result/source ordering. |
| 8 | integration | `tests/integration/agent-note-tools.integration.test.ts::B4_search_notes_uses_searchworkflow_filters_and_hybrid` | B4, Y2 | S3 | Binding test for real `SearchWorkflow` path. |
| 9 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::C1_read_note_uses_document_store` | C1 | S3 | Store read path only; no live vault/filesystem. |
| 10 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::C2_read_note_missing_target_fails_closed` | C2 | S3 | No broad fallback read/search. |
| 11 | integration | `tests/integration/agent-note-tools.integration.test.ts::C3_read_note_filters_and_sources_indexed_nodes` | C3, Y3, Y7 | S3 | Hermetic indexed store fixture with filters and source records. |
| 12 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::D1_assemble_draft_uses_prior_tool_outputs` | D1 | S4 | Draft content assembled from prior tool outputs. |
| 13 | unit/static | `tests/core/domain/agentNoteTools.test.ts::D2_assemble_draft_has_no_write_surface` | D2, Y4 | S9 | Static guard against vault/file-write APIs. |
| 14 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::D3_assemble_draft_carries_output_intent` | D3 | S4 | Carries output metadata for AGT-5. |
| 15 | contract | `tests/contract/agent-note-tools.contract.ts::E1_contract_trace_records_are_stable` | E1, Y6, Z5 | S3 | Stable traces without raw note content. |
| 16 | unit | `tests/core/workflows/AgentNoteToolRunner.test.ts::E2_budget_exhaustion_fails_closed` | E2, Y8 | S3, S9 | Budget stop behavior without unsafe fallback. |
| 17 | static | `package.json scripts + TypeScript compiler::npm run build` | Z1, Z3 |  | Build/no-`any` quality gate. |
| 18 | static | `eslint.config.mjs::npm run lint` | Z2, Z3, Z5 |  | Lint quality gate. |
| 19 | review | `/review-story AGT-3` | Z6 |  | Required story review gate. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | `read_note` target semantics are under-specified by AGT-2's minimal `AgentToolCallPlan`. | AGT-3 may extend `AgentToolCallPlan` with optional read-target fields while preserving existing AGT-2 tests and defaulting behavior. |
| 2 | Tool runner could accidentally duplicate search logic and drift from existing retrieval behavior. | Make `runSearch` delegation a binding criterion with integration evidence. |
| 3 | Draft assembly may be mistaken for final synthesis. | Keep AGT-3 assembly deterministic and in-memory; AGT-5 owns final synthesis formatting and presentation. |
| 4 | Static no-write tests can miss indirect writes introduced later. | Combine static checks with file touchpoint constraints and review gate `/review-story AGT-3`. |
| 5 | SQLite integration may be heavier than unit fixtures. | Use the smallest hermetic fixture that proves the adapter boundary; keep fast unit/contract tests for most edge cases. |

---

## Implementation Order

1. `src/core/domain/agentNoteTools.ts` - define tool budgets, typed request/result/trace contracts, stable source normalization, and unsupported-tool helpers (covers A1, A2, A4).
2. `src/core/domain/agentRetrievalPlan.ts` - add optional read-target fields to `AgentToolCallPlan` only if needed, preserving AGT-2 tests (covers C1, C2).
3. `src/core/ports/IAgentNoteToolPort.ts` and `src/core/ports/index.ts` - add the new port export (covers A3).
4. `tests/core/domain/agentNoteTools.test.ts` and `tests/contract/agent-note-tools.contract.ts` - write red tests for contracts, budgets, unsupported tools, stable traces, and bounded search results (covers A1-A4, B3, E1, Y1, Y6, Y8).
5. `src/core/workflows/AgentNoteToolRunner.ts` - implement `search_notes` by delegating to `runSearch`, inheriting plan filters and preserving stable source output (covers B1-B4, Y2, Y5).
6. `src/core/workflows/AgentNoteToolRunner.ts` - implement `read_note` through `IDocumentStore`, target resolution, missing-target failure, dedupe, filter preservation, and budget caps (covers C1-C3, Y3, Y7).
7. `src/core/workflows/AgentNoteToolRunner.ts` - implement `assemble_draft` as in-memory draft assembly from prior tool outputs with no provider call and no write surface (covers D1-D3, Y4).
8. `tests/core/workflows/AgentNoteToolRunner.test.ts` and `tests/integration/agent-note-tools.integration.test.ts` - add runner and integration tests for delegation, filters, sources, budgets, and no unsafe fallback (covers B1-B4, C1-C3, D1-D3, E2).
9. `src/core/index.ts`, `vitest.config.ts`, and `README.md` - export new public core surface, include contract tests if needed, and keep the AGT-3 backlog row linked but `Not Started` until implementation is complete.
10. **Final verify** - run `npm run build`, `npm run lint`, focused AGT-3 tests, relevant SearchWorkflow/IDocumentStore regression tests, and `/review-story AGT-3` (covers Z1-Z6).

---

*Created: 2026-04-30 | Story: AGT-3 | Epic: 12 - Deterministic agentic note synthesis*
