# ADR-002: Hierarchical document model instead of flat chunks

## Status

Accepted

## Context

Flat chunking (small snippets without document structure) produces **decontextualized** search hits and **weak chat context**: the model sees unrelated fragments instead of how the user organized ideas (headings, lists, nesting).

The product needs **semantic search** and **chat** that reflect **note structure** while still respecting **embedding limits** per node.

## Decision

1. **Tree-structured index:** Each note is represented as a **hierarchy of typed nodes** (e.g. note → topic/subtopic → paragraph, bullet groups, nested bullets), with explicit parent/child relationships, ordering among siblings, and full heading trails—not only the “last heading.”

2. **Multiple granularities:** Indexing and retrieval use both **coarse** (sections/summaries) and **fine** (paragraphs/bullets) units so search can zoom into the right region without losing surrounding structure at assembly time.

3. **Summaries at non-leaf levels:** The system generates **LLM summaries bottom-up** for non-leaf nodes to support coarse retrieval; leaves may use raw content as their own “summary” when appropriate. **Incremental updates** regenerate summaries along the path from edited nodes to the root.

4. **Splitting rules:** Long paragraphs split on **sentence boundaries** with stable ordering for reassembly; **bullet groups** follow explicit grouping rules (e.g. consecutive bullets without blank lines).

## Consequences

- **Positive:** Better retrieval quality and more faithful chat context; structure-aware UX becomes possible.
- **Negative:** Higher indexing cost, more moving parts (summary jobs, incremental propagation), and more storage than a flat chunk list.

## Alternatives considered

- **Flat chunks with larger windows:** Simpler, but still loses explicit structure and complicates “navigate to the right section.”
- **Whole-note embedding only:** Fails for long notes and mixes unrelated topics in one vector.
- **Sentence-only index:** High precision on tiny spans, weak on thematic/contextual queries.

## References

- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §5
