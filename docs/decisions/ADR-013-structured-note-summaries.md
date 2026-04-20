# ADR-013: Structured note and topic summaries (breadth-preserving rubric)

**Status:** Accepted  
**Date:** 2026-04-16

---

## Context

[ADR-002](ADR-002-hierarchical-document-model.md) decided that non-leaf nodes receive LLM-generated summaries so the coarse retrieval phase ([ADR-003](ADR-003-phased-retrieval-strategy.md)) can locate candidate regions. The current implementation, in [`SummaryWorkflow.summarizeNonLeaf`](../../src/core/workflows/SummaryWorkflow.ts), uses a prose prompt:

> "You are a concise note indexer. Produce a short summary (2–4 sentences) of the child sections for hierarchical search."

This works for uniform narrative notes but fails badly on three common real-world note shapes:

1. **Daily notes** — short, heterogeneous entries mixing work, journal, job search, errands. A 2–4-sentence prose summary inevitably drops most topics; whichever the LLM picks to mention wins the coarse phase, the others become invisible to semantic retrieval.
2. **Topic dumps** — long topic sections that enumerate many entities, dates, or decisions. Dense prose compresses breadth into a fuzzy paragraph that is semantically adjacent to many queries but strongly matches few.
3. **Reference / index notes** — MOC-style notes whose whole purpose is to list many things. A prose summary flattens the list.

Because summary embeddings are the **primary coarse-retrieval signal**, losing breadth at this layer directly causes the false negatives users report (entity or date-specific queries against daily notes that clearly contain the answer).

Additionally, every non-leaf node currently gets a summary and a summary embedding, including `bullet_group` nodes whose content is fully represented by their `bullet` children. This wastes LLM calls and dilutes coarse recall with redundant vectors.

---

## Decision

1. **Structured rubric for `note`, `topic`, and `subtopic` summaries.** Replace the 2–4-sentence prose prompt with a prompt that instructs the model to emit a bounded, structured summary covering:
   - **Topics discussed** — short phrases, one per distinct theme.
   - **Named entities** — people, organizations, products, project codenames.
   - **Dates and time references** — absolute and relative (e.g. "2026-02-14", "last Tuesday", "this sprint").
   - **Actions and decisions** — imperative phrases ("applied to Acme Corp", "decided to pause Project X").
   - **Tags** — inline and frontmatter tags collected from this subtree.

   The model output is a short structured text block (Markdown list or labeled sections) rather than prose. The structured text is what gets embedded for summary ANN, so the resulting vector is a linear combination of many breadth-preserving phrases rather than a single dense paragraph.

2. **Bounded length, not prose length.** The summary prompt enforces a **token budget** (default ≈ 180 tokens per summary, configurable) and a **per-field item cap** (e.g. up to 10 topics, up to 15 entities, up to 15 actions, all tags). Over-budget content is truncated; the **model is instructed** to prefer breadth over depth.

3. **`bullet_group` is not summarized.** Summary generation and summary embeddings are **skipped** for `bullet_group` nodes. Their signal is carried by their `bullet` children's content embeddings. This removes ~15–30% of LLM summary calls in typical bulleted notes and reduces coarse-phase noise. Other leaf-like node types (`paragraph`, `sentence_part`, `bullet`) were already skipped; this decision formalizes and extends that set. See the [ADR-002 update](ADR-002-hierarchical-document-model.md) for the authoritative node-type list.

4. **Prompt shape per node type.**
   - `note` summary prompt receives: note title, full heading outline of children, and each direct child's **structured summary** (or raw content if the child is a leaf). Output rubric covers the whole note.
   - `topic` / `subtopic` prompts receive the section heading trail and each direct child's structured summary or raw content. Output rubric is scoped to the section.

   The prompt format is co-located in [`src/core/workflows/SummaryWorkflow.ts`](../../src/core/workflows/SummaryWorkflow.ts) as a versioned constant (e.g. `SUMMARY_RUBRIC_V1`), mirroring [ADR-011](ADR-011-vault-only-chat-grounding.md)'s policy-version pattern so retrieval-quality tests can pin behavior.

5. **Incremental behavior preserved.** Staleness / skip logic from [WKF-1](../features/WKF-1.md) and [ADR-008](ADR-008-idempotent-indexing-state-machine.md) is unchanged: summaries regenerate when any descendant changes. The rubric format is a prompt change, not a storage-shape change — the `summaries.summary` column still stores a single string.

6. **Reindex is the upgrade path.** Existing prose summaries remain usable until reindexed. A full reindex regenerates structured summaries and their embeddings. The storage guide documents this.

---

## Consequences

**Positive**

- Coarse-phase recall improves for heterogeneous notes (daily notes, MOCs) because summary vectors represent multiple topics simultaneously.
- Entity and date mentions survive summary compression, so hybrid retrieval ([ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)) has a semantic backup when BM25 tokenization misses.
- `bullet_group` skip trims the summary corpus without losing retrievability (bullets are already content-embedded).

**Negative / costs**

- Structured prompts are slightly longer than the current prose prompt, raising per-summary token cost by ~20–40%. Partially offset by skipping `bullet_group` summaries.
- Structured text is less human-readable in the UI if surfaced verbatim; the chat context assembly in [RET-2](../features/RET-2.md) is already responsible for formatting, so this is a UI-layer concern, not a storage-shape concern.
- Users who liked the old prose summaries (if exposed anywhere) will see a different shape after reindex.

---

## Alternatives considered

| Alternative                                                         | Why not chosen                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep prose summaries; raise summary length to 8–10 sentences        | Longer prose does not fix breadth; the model still writes around, not across, many topics. Also worsens embed cost.                              |
| Generate multiple summaries per node (one per topic)                | Multiplies LLM calls and storage; unclear how to canonicalize; duplicate retrieval noise.                                                        |
| Drop summary embeddings entirely; rely on hybrid + content fallback | Coarse phase is still valuable when summaries are good; disabling it regresses notes where headings are terse but sections are dense.            |
| Use title/heading concatenation as "summary"                        | Very cheap, but ignores actual note content; fails on notes whose headings are generic ("Notes", "Update") but whose bodies are highly specific. |

---

## Explicit non-decisions

- This ADR does **not** specify the exact model output format (YAML vs Markdown list vs labeled sections); that is an implementation choice tracked as `SUMMARY_RUBRIC_VERSION`.
- This ADR does **not** change chat context assembly or Phase 3 budgets; structured summaries still flow into the same "parent summary" tier per [RET-2](../features/RET-2.md).
- This ADR does **not** introduce per-field retrieval (e.g. "search entities only"); all fields still live in the same summary embedding.
- The exact per-field caps and the per-summary token budget are tunable; Phase B feature stories establish defaults.

---

## Links

- Requirements: [REQUIREMENTS §5](../requirements/REQUIREMENTS.md), [§15](../requirements/REQUIREMENTS.md)
- Supersedes: prose prompt in [`SummaryWorkflow.summarizeNonLeaf`](../../src/core/workflows/SummaryWorkflow.ts)
- Related ADRs: [ADR-002](ADR-002-hierarchical-document-model.md), [ADR-003](ADR-003-phased-retrieval-strategy.md), [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)
- Related stories: [WKF-1](../features/WKF-1.md), WKF-4
