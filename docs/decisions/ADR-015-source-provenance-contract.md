# ADR-015: Source provenance contract — sources equal notes actually used

**Status:** Accepted
**Date:** 2026-04-21

---

## Context

[BUG-001](../requests/BUG-001.md) and its refined form [REQ-006](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) report that on chat responses the `sources` list includes notes that were not actually used in the reply, and that notes the reply draws from are sometimes missing. The user explicitly resolved the semantics in REQ-006 §6:

- **Q1** "outside filtering criteria" means "not meeting filtering criteria" — a note that is not in the final results used for the reply must not appear in `sources`.
- **Q3** "referenced in the response" means "used in any way for the response" — including aggregation answers where individual notes are not named inline.

Today, [`runChatStream`](../../src/core/workflows/ChatWorkflow.ts) assembles a retrieval context by joining every `SearchResult.snippet`, then returns `sources` as the cartesian list of those results (`notePath`, `nodeId`). That means every retrieved hit is advertised as a source, even if the provider's answer does not draw from some of them, and even if filters applied downstream (tag / path / date) would have excluded them. With [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md) raising coarse-K to 32 and [ADR-014](ADR-014-temporal-and-path-filters.md) adding optional filters, the mismatch between advertised sources and the notes the user can verify in the reply is now large enough to degrade perceived trust (REQ-006 Q3 rationale: "aggregations without sources reduce trust").

Separately, the README's §10 context formatting and §21 provenance section (added with REQ-006) commit to "sources = notes actually used" at the product level. Without an ADR, adapters and workflows could drift back to the "retrieval set ≠ usage set" state silently.

---

## Decision

Codify a single product contract for `sources` on both `chat` and `search` responses:

1. **`sources` is the set of notes whose content was used to produce the reply.** Nothing more, nothing less.
2. **No filter bypass.** A note excluded by the effective `NodeFilter` (`tags`, `pathGlobs`, `dateRange` per [ADR-014](ADR-014-temporal-and-path-filters.md)) for a given turn must not appear in `sources`, regardless of what any intermediate retrieval stage emitted before filtering.
3. **Per-turn used-node set.** `ChatWorkflow` tracks which retrieved nodes were placed into the final context the model answers from (post-rerank, post-budget-trimming — i.e. the snippets actually stitched into `context`). Only those nodes' owning notes are emitted as `Source[]`.
4. **Aggregation is a first-class case.** When the reply is an aggregate ("How many job applications did I log this month?") the per-turn used-node set is every node that contributed to the aggregate, even though none is cited inline. `sources` still lists them all.
5. **Insufficient-evidence path.** When [ADR-011](ADR-011-vault-only-chat-grounding.md) returns the insufficient-evidence message, `sources` is `[]`. No exceptions.
6. **Search parity.** `SearchResponse.results` — each `SearchResult`'s `noteId`/`notePath` — equals the set of notes the user sees ranked. Nothing retrieved but later dropped by a filter (e.g. coarse-phase tag prune) may appear in the final `results`.

Deduplication: if two nodes from the same note are both used, the note appears once in `sources` (the `Source` contract is note-scoped, not node-scoped). Stable ordering: `sources` follows the usage order of the first node contributing from each note.

---

## Consequences

**Positive**

- `sources` becomes a trustworthy UI surface: clicking opens a note that genuinely underpins the reply.
- Aggregation answers ("how many", "list all") remain auditable — the user can click through to verify each contributor.
- Filters become observable — a user who expects `pathGlobs: ['daily/**']` to exclude project notes can verify that no project note appears in `sources`.

**Negative / costs**

- `ChatWorkflow` must carry a used-node set through context assembly and answer streaming; a small state addition.
- When the context-assembly budget forces a snippet to be dropped after it was included in `searchRes.results`, the corresponding note must be dropped from `sources` too. That is a behavior change from today's "advertise every retrieved hit".
- Tests must assert the equality bidirectionally (every source is used; every used note is a source). Unit-level assertions on `sources` content grow in count.

---

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Keep "sources = retrieved set" and surface a separate "used" flag per source | Requires UI change and still shows noise; fails REQ-006 S1's "every note listed as a source is referenced in the reply". |
| Let the LLM self-declare its sources in the output stream | Violates [ADR-011](ADR-011-vault-only-chat-grounding.md) (grounding is product-owned, not model-owned) and introduces hallucination risk. |
| Attach sources only for "extractive" replies, not aggregations | Contradicts the user's explicit resolution (REQ-006 Q3: "if a note's content contributed, list it"). |
| Derive sources downstream in the plugin by re-parsing the streamed reply | Duplicates retrieval knowledge in the plugin and cannot recover used-node info from opaque provider streams. |

---

## Explicit non-decisions

- This ADR does **not** change how sources render in the UI (pills vs links vs footnotes); that stays in `ChatView` per §UI Components.
- This ADR does **not** define per-source score exposure; only the identity (notePath) and any node anchor already present.
- This ADR does **not** define per-span citation inside the assistant reply; the scope is the per-turn source list only.
- This ADR does **not** change `IChatPort` or adapters; the provenance tracking is in `ChatWorkflow` / `SearchWorkflow`, upstream of the port.
- This ADR does **not** retroactively rewrite prior responses' sources; it applies prospectively.

---

## Links

- Requirements: [REQ-006 §4 S1/S2/S7, §6 Q1/Q3](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md)
- Related README sections: [§21 Source Provenance Contract](../../README.md#21-source-provenance-contract), [§10 Structured Context Formatting](../../README.md#10-structured-context-formatting), [API Contract](../../README.md#api-contract)
- Related stories: BUG-1 (this ADR's primary consumer)
- Related ADRs: [ADR-011](ADR-011-vault-only-chat-grounding.md), [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md), [ADR-014](ADR-014-temporal-and-path-filters.md)
