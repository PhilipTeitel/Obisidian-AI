# BUG-1: Source provenance contract — sources equal notes actually used

**Story**: Make the `sources` list returned on every `chat` completion and `search` response equal the set of notes whose content was actually used to produce the reply — bidirectionally, no more and no less — including the aggregation case. This fixes the BUG-001 / REQ-006 reports that `sources` contains notes outside the filtering criteria or omits notes the reply drew from.
**Epic**: 11 — Chat accuracy and UX bug fixes (REQ-006)
**Size**: Medium
**Status**: Open

---

## 1. Summary

Today, [`runChatStream`](../../src/core/workflows/ChatWorkflow.ts) emits `Source[]` as the cartesian list of every `SearchResult` produced by `runSearch` — regardless of whether every result's snippet actually made it into the assembled retrieval context the model answers from, and regardless of whether downstream filtering dropped some results after retrieval. That produces the user-visible symptom in [BUG-001](../requests/BUG-001.md): notes appear under **Sources** that never contributed to the reply and notes referenced in the reply are not listed as sources. [REQ-006 §6](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) resolved the semantics precisely — `sources` = notes *used in any way to produce the reply*, inclusive of aggregations — and [ADR-015](../decisions/ADR-015-source-provenance-contract.md) binds them.

This story threads a **per-turn used-node set** through `ChatWorkflow` and `SearchWorkflow`. Every time a snippet is stitched into the `context` string for the model (post-rerank, post-budget-trimming), the owning node's id is recorded. On stream completion the sidecar emits `sources` as the deduplicated, insertion-ordered list of notes drawn from that used-node set. The insufficient-evidence path ([ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md)) continues to emit `sources: []`. Parallel parity work on the `search` response (`SearchResponse.results`) ensures any node excluded by filters after retrieval is also excluded from the visible result list.

**Out-of-scope `Sn` from REQ-006:** S3 (selectable text; owned by BUG-2), S4 (natural-language dates; BUG-3), S5/S6 (FTS sanitization; BUG-4). This story does not change retrieval ranking, context budgets, or filter semantics — only the accounting for which retrieved nodes ultimately contributed to the reply.

**Prerequisites:** [CHAT-1](CHAT-1.md), [CHAT-3](CHAT-3.md), [RET-1](RET-1.md), [RET-6](RET-6.md). **Linked REQ:** [REQ-006](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-015-source-provenance-contract.md`](../decisions/ADR-015-source-provenance-contract.md) | Defines the bidirectional equality between `sources` and notes used in the reply, including aggregation behavior, filter exclusion, and search parity. Primary ADR for this story. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | Insufficient-evidence path must emit `sources: []`; the provenance tracking must preserve this without regression. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Filter contract (`tags`, `pathGlobs`, `dateRange`): no note excluded by an effective filter may appear in `sources`. |
| [`docs/decisions/ADR-003-phased-retrieval-strategy.md`](../decisions/ADR-003-phased-retrieval-strategy.md) | Phase-3 context assembly is the boundary where "retrieved" becomes "used"; tracking happens at that boundary. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs (ADR-015, ADR-011, ADR-014, ADR-003) exist and are **Accepted**
- [ ] README §21 (Source Provenance Contract), API Contract `chat` / `search` rows, and ADR-015 do not contradict each other on the definition of `sources`
- [ ] Section 4 (Binding constraints) lists 6 bullets restated from ADR-015 and REQ-006 §6 rows 1 and 3
- [ ] Section 4b (Ports & Adapters) declares "no new adapter" with one sentence of why (tracking lives in core workflows, upstream of ports)
- [ ] Section 8a (Test Plan) contains rows for every AC ID in Section 8 (including Phase Y and Phase Z) and every Gherkin `Sn` from REQ-006 that this story implements (S1, S2, S7)
- [ ] Phase Y contains at least one `(binding)` criterion citing a **non-mock** integration test that asserts the bidirectional equality end-to-end with a real provider stream

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `sources` on every `chat` response equals the set of notes whose nodes are in the per-turn **used-node set** (the nodes whose snippets were stitched into the model's `context`). No note outside that set may appear.
2. **Y2** — Every note whose content contributed to the reply (including aggregations where no node is named inline) appears in `sources`. Omission is a failure.
3. **Y3** — Filter exclusion is absolute: a note excluded by the effective `NodeFilter` (`tags`, `pathGlobs`, `dateRange`) for the turn must not appear in `sources`, even if retrieval emitted it upstream.
4. **Y4** — The insufficient-evidence path emits `sources: []`. No exceptions.
5. **Y5** — `sources` is deduplicated per note (not per node) and ordered by first-contributing-node insertion order.
6. **Y6** — `SearchResponse.results` for `search` excludes any hit that failed a downstream filter; UI-visible results equal the used/returned set.

---

## 4b. Ports & Adapters

**Not applicable — this story does not introduce or modify any port or adapter.** Per [ADR-005 Decision 5](../decisions/ADR-005-provider-abstraction.md) and [ADR-015](../decisions/ADR-015-source-provenance-contract.md), the used-node bookkeeping lives in `ChatWorkflow` / `SearchWorkflow` (core) and is emitted in the response DTO upstream of `IChatPort`. `IDocumentStore` / `IChatPort` signatures are unchanged. No adapter integration tests are required for binding compliance; the binding is asserted against the real-provider end-to-end chat path (Phase Y1 below).

---

## 5. API Endpoints + Schemas

No wire-shape changes. The existing `done { sources, groundingOutcome, groundingPolicyVersion }` terminal message for the `chat` route ([API Contract](../../README.md#sidecar-message-protocol)) and the `SearchResponse.results` shape for `search` remain byte-identical on the wire. The **semantics** of `sources` and `results` tighten per ADR-015.

Tight internal types (optional, for clarity — not required on the wire):

```ts
// src/core/domain/types.ts — additions are internal, not sent verbatim
export interface UsedNodeRecord {
  /** Node whose snippet was stitched into the retrieval context for this turn. */
  nodeId: string;
  /** Owning note's vault-relative path, populated at stitching time. */
  notePath: string;
  /** Rank order in which the node first entered the context window. */
  insertionOrder: number;
}
```

The internal `runChatStream` return type is extended to carry the used-node set through to the sidecar, which then projects to `Source[]` on the wire per the existing DTO.

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

```
ChatView
└── streamChat(payload)
    └── done { sources: Source[], groundingOutcome, groundingPolicyVersion }
        └── renders <SourceChip notePath=... /> — one chip per entry in `sources`
```

`ChatView` needs **no rendering changes**. The existing source-chip rendering path already de-duplicates by `notePath` and opens the note on click. What changes is the content of the `sources` array it receives from the sidecar.

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatView.renderSources(sources: Source[])` | unchanged | none | With ADR-015 honored, this function now renders only notes actually used. |
| Source pill click handler | `(source: Source) => void` | none | Unchanged. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Source chip row shows nothing until `done`. Unchanged. |
| Error | On stream error the chip row stays empty. Unchanged. |
| Empty (insufficient evidence) | `groundingOutcome === 'insufficient_evidence'` → no chips (Y4). Unchanged behaviorally; asserted by test. |
| Success | One chip per entry in `sources`, each corresponding to a note genuinely used in the reply. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `tests/core/workflows/ChatWorkflow.sources.test.ts` | Unit: used-node set correctness — happy path, aggregation, post-budget drop, insufficient-evidence empty, filter-exclusion. (A1–A5, Y1–Y6). |
| 2 | `tests/core/workflows/SearchWorkflow.sources.test.ts` | Unit: `SearchResponse.results` excludes filter-failing hits; covers Y6 / S1 / S2 parity. |
| 3 | `tests/integration/chat-stream-sources.integration.test.ts` | Integration: real stream → real used-node tracking; asserts every `Source` is a note whose snippet appeared in `context`, and vice versa. Binding evidence for Y1. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/ChatWorkflow.ts` | After `runSearch`, assemble `context` by iterating `searchRes.results` and recording each `{ nodeId, notePath }` into a per-turn `UsedNodeRecord[]` as it is stitched in (or dropped by budget). Project to `Source[]` on return; dedupe by `notePath` preserving insertion order (Y1, Y2, Y5). |
| 2 | `src/core/workflows/SearchWorkflow.ts` | After final `ranked.slice(0, k)` + filter application, ensure `SearchResponse.results` contains only entries for nodes that survived every filter applied in this turn (Y6). Remove any mid-pipeline retrieval entries that were filtered out post-ranking. |
| 3 | `src/core/domain/contextAssembly.ts` | If the assembly helper drops a snippet for budget reasons, report that to the caller so the dropped node is excluded from the used-node set (Y1). |
| 4 | `src/core/domain/types.ts` | Add internal `UsedNodeRecord` (optional) for test clarity; `Source[]` wire shape unchanged. |
| 5 | `src/sidecar/runtime/SidecarRuntime.ts` | Ensure the final `done` message for `chat` emits the `Source[]` returned from `runChatStream` verbatim (no re-derivation from retrieval). |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/adapters/chatProviderMessages.ts` — message assembly unchanged; used-node tracking is upstream of `IChatPort`.
- `src/sidecar/adapters/OpenAIChatAdapter.ts`, `src/sidecar/adapters/OllamaChatAdapter.ts` — adapters continue to forward messages verbatim; no port surface change.
- `src/plugin/ui/ChatView.ts` — rendering of `sources` is unchanged; the content just becomes trustworthy.

---

## 8. Acceptance Criteria Checklist

### Phase A: Used-node tracking in ChatWorkflow

- [ ] **A1** — `runChatStream` records a `UsedNodeRecord` each time a `SearchResult` snippet is stitched into `context`
  - When every result fits the budget: one record per result; `sources.length === new Set(results.map(r => r.notePath)).size`.
  - Evidence: `tests/core/workflows/ChatWorkflow.sources.test.ts::A1_one_record_per_stitched_snippet(vitest)`

- [ ] **A2** — Records are deduped per `notePath` on the way to `Source[]`, preserving first-insertion order
  - Two results from the same note → one `Source` entry at the first result's position.
  - Evidence: `tests/core/workflows/ChatWorkflow.sources.test.ts::A2_dedup_preserves_insertion_order(vitest)`

- [ ] **A3** — Aggregation replies still list every contributing note
  - With three `SearchResult` entries stitched into context (representing three job-search notes) and the reply being "I found 3 activities", `sources.length === 3`.
  - Evidence: `tests/core/workflows/ChatWorkflow.sources.test.ts::A3_aggregation_lists_all_contributors(vitest)` — covers S7.

- [ ] **A4** — Snippets dropped by context-assembly budget do not appear in `sources`
  - When the token budget forces the last result's snippet to be dropped before it reaches `context`, its note must not appear in `sources`.
  - Evidence: `tests/core/workflows/ChatWorkflow.sources.test.ts::A4_budget_drop_excludes_source(vitest)`

- [ ] **A5** — Insufficient-evidence path emits `sources: []`
  - `searchRes.results.length === 0` → `sources: []`, `groundingOutcome: 'insufficient_evidence'`.
  - Evidence: `tests/core/workflows/ChatWorkflow.sources.test.ts::A5_insufficient_evidence_empty_sources(vitest)`

### Phase B: Filter parity in SearchWorkflow

- [ ] **B1** — `SearchResponse.results` excludes any hit whose note fails the effective `pathGlobs` filter
  - With `pathGlobs: ['daily/**']`, a retrieved hit whose note lives under `projects/` must not appear in `results`.
  - Evidence: `tests/core/workflows/SearchWorkflow.sources.test.ts::B1_path_glob_filter_excludes(vitest)` — covers S1.

- [ ] **B2** — `SearchResponse.results` excludes any hit whose note fails the effective `dateRange` filter
  - With `dateRange: { start: '2026-03-16', end: '2026-04-21' }`, a retrieved note with `note_date: '2026-02-14'` must not appear in `results`.
  - Evidence: `tests/core/workflows/SearchWorkflow.sources.test.ts::B2_date_range_filter_excludes(vitest)` — covers S2.

- [ ] **B3** — `SearchResponse.results` excludes any hit whose node fails the effective `tags` filter
  - `tags: ['jobhunt']` must exclude nodes without that tag.
  - Evidence: `tests/core/workflows/SearchWorkflow.sources.test.ts::B3_tags_filter_excludes(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** End-to-end chat stream: every `Source` in the final `done` message is a note whose snippet is observable in the assembled `context`, and vice versa
  - Assert bidirectional equality against a real `ChatWorkflow` run with a recorded provider stream; no mocking of the provenance bookkeeping.
  - Evidence: `tests/integration/chat-stream-sources.integration.test.ts::Y1_bidirectional_equality_real_stream(vitest)` — covers S1 end-to-end.

- [ ] **Y2** — **(binding)** Aggregation replies list every contributing note in `sources`
  - Integration test with three same-epoch daily notes and an aggregation-style prompt; assert `sources` is exactly the three note paths.
  - Evidence: `tests/integration/chat-stream-sources.integration.test.ts::Y2_aggregation_all_contributors(vitest)` — covers S7.

- [ ] **Y3** — **(binding)** Filter-excluded notes never appear in `sources`
  - With `pathGlobs: ['daily/**']` applied, assert no `Source` entry has a `notePath` outside `daily/**`, even when the raw retrieval stage emitted such candidates upstream.
  - Evidence: `tests/integration/chat-stream-sources.integration.test.ts::Y3_filter_excluded_never_in_sources(vitest)` — covers S1 "not meeting filtering criteria".

- [ ] **Y4** — **(binding)** Insufficient-evidence path emits `sources: []`
  - Evidence: `tests/integration/chat-stream-sources.integration.test.ts::Y4_insufficient_evidence_empty(vitest)`.

- [ ] **Y5** — **(binding)** Deduplication preserves first-insertion order
  - Two results from the same note in positions 1 and 3 → `sources[0] === that note path`; no duplicate.
  - Evidence: `tests/core/workflows/ChatWorkflow.sources.test.ts::A2_dedup_preserves_insertion_order(vitest)` (shared with A2).

- [ ] **Y6** — **(binding)** `SearchResponse.results` parity: any filter-excluded hit is absent from `results`
  - Evidence: `tests/core/workflows/SearchWorkflow.sources.test.ts::B1_path_glob_filter_excludes(vitest)`, `B2_date_range_filter_excludes`, `B3_tags_filter_excludes`.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use the project's configured alias (not relative paths) where applicable
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per [§20 Logging and Observability](../../README.md#20-logging-and-observability) (debug-level trace when a snippet is dropped by budget; info-level count on chat completion)
- [ ] **Z6** — `/review-story BUG-1` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/workflows/ChatWorkflow.sources.test.ts::A1_one_record_per_stitched_snippet` | A1 | S1 | Happy path — every stitched result produces one used-node record. |
| 2 | unit | `tests/core/workflows/ChatWorkflow.sources.test.ts::A2_dedup_preserves_insertion_order` | A2, Y5 | S1 | Two results from the same note → one source entry. |
| 3 | unit | `tests/core/workflows/ChatWorkflow.sources.test.ts::A3_aggregation_lists_all_contributors` | A3 | S7 | Aggregation case — sources include every contributor. |
| 4 | unit | `tests/core/workflows/ChatWorkflow.sources.test.ts::A4_budget_drop_excludes_source` | A4 | S1 | Budget-dropped snippet excluded from sources. |
| 5 | unit | `tests/core/workflows/ChatWorkflow.sources.test.ts::A5_insufficient_evidence_empty_sources` | A5, Y4 | — | Empty sources on insufficient evidence. |
| 6 | unit | `tests/core/workflows/SearchWorkflow.sources.test.ts::B1_path_glob_filter_excludes` | B1, Y6 | S1 | Path filter parity. |
| 7 | unit | `tests/core/workflows/SearchWorkflow.sources.test.ts::B2_date_range_filter_excludes` | B2, Y6 | S2 | Date-range filter parity. |
| 8 | unit | `tests/core/workflows/SearchWorkflow.sources.test.ts::B3_tags_filter_excludes` | B3, Y6 | — | Tags filter parity. |
| 9 | integration | `tests/integration/chat-stream-sources.integration.test.ts::Y1_bidirectional_equality_real_stream` | Y1 | S1 | Binding — real stream, real workflow; every source in context, every used note in sources. |
| 10 | integration | `tests/integration/chat-stream-sources.integration.test.ts::Y2_aggregation_all_contributors` | Y2 | S7 | Binding — aggregation case end-to-end. |
| 11 | integration | `tests/integration/chat-stream-sources.integration.test.ts::Y3_filter_excluded_never_in_sources` | Y3 | S1 | Binding — filter exclusion is absolute. |
| 12 | integration | `tests/integration/chat-stream-sources.integration.test.ts::Y4_insufficient_evidence_empty` | Y4 | — | Binding — empty-sources invariant preserved. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Context assembly may drop snippets without signaling — used-node set could over-report. | Section 7 modification #3 wires the drop signal from `contextAssembly` into `ChatWorkflow` so dropped snippets are excluded from `UsedNodeRecord[]`. Verified by A4. |
| 2 | Adapter-side provider that paraphrases rather than quoting could be interpreted as "not used" by the user, even if sources are correct per ADR-015. | ADR-015 Q3 resolution makes "used in any way" the definition. Aggregation test (A3/Y2) exercises exactly this. |
| 3 | Tests that currently assert "sources == retrieval hits" will fail. | Catalog and update such tests as part of this story. Broken assertions are the desired outcome — they encoded the bug. |
| 4 | Stream ordering: `done` must only fire after the last delta so that the used-node set is final. | Existing stream guard ([ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md)) already enforces this; no change. |

---

## Implementation Order

1. `src/core/domain/types.ts` — add internal `UsedNodeRecord` for test clarity (covers A1).
2. `src/core/domain/contextAssembly.ts` — expose "snippet dropped for budget" to the caller (covers A4).
3. `src/core/workflows/ChatWorkflow.ts` — thread `UsedNodeRecord[]` through stitching; project to `Source[]` with dedup at return (covers A1, A2, A3, A5, Y5).
4. `src/core/workflows/SearchWorkflow.ts` — filter-parity on `SearchResponse.results` (covers B1–B3, Y6).
5. `tests/core/workflows/ChatWorkflow.sources.test.ts` — red-first for A1–A5.
6. `tests/core/workflows/SearchWorkflow.sources.test.ts` — red-first for B1–B3.
7. **Verify** — `npm run test:unit` green for rows 1–8.
8. `tests/integration/chat-stream-sources.integration.test.ts` — red-first for Y1–Y4.
9. `src/sidecar/runtime/SidecarRuntime.ts` — emit `done.sources` from `runChatStream` return value verbatim.
10. **Verify** — `npm run test` green; `/review-story BUG-1` clean.
11. **Final verify** — full `npm run build` + manual chat smoke test in a populated vault.

---

*Created: 2026-04-21 | Story: BUG-1 | Epic: 11 — Chat accuracy and UX bug fixes (REQ-006)*
