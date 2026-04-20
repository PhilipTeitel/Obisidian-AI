# ADR-003: Phased retrieval (summary → drill-down → context assembly)

## Status

Accepted

## Context

With a hierarchical model, **naive** flat top-K vector search either returns tiny irrelevant spans or mixes unrelated sections. The product needs retrieval that **mimics how a human** locates material: coarse location, then fine detail, then reading surrounding structure.

## Decision

1. **Phase 1 — Coarse (summary search):** Embed the user query and search **summary embeddings** first to find **candidate regions** (topics/subtopics/note-level summaries as modeled).

2. **Phase 2 — Drill-down:** Within candidates, search **content embeddings** of descendants, recursing as needed until high-confidence **leaf** matches are found.

3. **Phase 3 — Context assembly:** For each selected leaf (or equivalent), **walk up** the tree to collect heading trails, **sibling** context where useful, and **ancestor summaries**, then **format** a single structured context block for chat (and for search UI), respecting **per-tier token budgets** (matched vs sibling vs parent-summary tiers).

4. **Comparable embeddings:** Query, summary, and content vectors used in these phases must be **in the same embedding space** (same embedding model configuration).

## Amendments (iter-2)

- **Coarse-K cap superseded.** The `kSummary = min(k, 8)` mapping originally documented in [RET-1 §5](../features/RET-1.md) is **superseded by [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)**. Phase 1 now honors a user-configurable `coarseK` (default 32); there is no hard cap at 8.
- **Content-only fallback.** When Phase 1 returns fewer usable summary hits than a configurable floor, the workflow runs an additional **unrestricted `vec_content` ANN** (no subtree filter) and merges its matches into the candidate set. This replaces the original "return empty when Phase 1 is empty" policy from [RET-1 Y4](../features/RET-1.md). See [ADR-012 §2](ADR-012-hybrid-retrieval-and-coarse-k.md).
- **Hybrid pre-merge stage.** Phase 1 candidates are now produced by **reciprocal rank fusion** of summary vector ANN + BM25 keyword hits over an FTS5 index on `nodes.content`. When hybrid is disabled by setting, Phase 1 runs vector-only. See [ADR-012 §3–§5](ADR-012-hybrid-retrieval-and-coarse-k.md).
- **Structured summaries.** The summary vectors feeding Phase 1 are produced from a breadth-preserving structured rubric, not free prose. See [ADR-013](ADR-013-structured-note-summaries.md).
- **Optional filters.** `SearchRequest` accepts optional `pathGlobs` and `dateRange` filters that are pushed into SQLite before ANN scoring across all phases and the fallback. See [ADR-014](ADR-014-temporal-and-path-filters.md).

## Consequences

- **Positive:** Chat receives coherent, structure-preserving context; fewer “random sentence” failures.
- **Negative:** More round-trips to the store/embedder than one-shot flat search; tuning costs (K values, budgets).

## Alternatives considered

- **Single-phase flat top-K:** Simple but reproduces the decontextualization problem the hierarchy is meant to fix.
- **Re-ranking only:** Helps ordering but does not fix missing structural context.
- **Full-graph traversal without vector gating:** Too expensive at scale.

## References

- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §5
- [ADR-002-hierarchical-document-model.md](./ADR-002-hierarchical-document-model.md)
- [ADR-012-hybrid-retrieval-and-coarse-k.md](./ADR-012-hybrid-retrieval-and-coarse-k.md) — configurable `coarseK`, content-only fallback, hybrid RRF
- [ADR-013-structured-note-summaries.md](./ADR-013-structured-note-summaries.md) — structured summary rubric feeding Phase 1
- [ADR-014-temporal-and-path-filters.md](./ADR-014-temporal-and-path-filters.md) — optional `pathGlobs` and `dateRange` filters
