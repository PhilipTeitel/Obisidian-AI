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
