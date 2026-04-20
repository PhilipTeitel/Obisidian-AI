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

   **Summary-embedding node-type policy (iter-2):** Not every non-leaf produces a **summary vector**. Types that add no semantic signal beyond their already-embedded children are excluded from summary generation and summary embedding:

   | Node type       | Summary generated? | Summary embedded? | Rationale                                                                 |
   | --------------- | ------------------ | ----------------- | ------------------------------------------------------------------------- |
   | `note`          | yes                | yes               | Whole-note rubric drives coarse retrieval.                                |
   | `topic`         | yes                | yes               | Section-level rubric drives coarse retrieval.                             |
   | `subtopic`      | yes                | yes               | Section-level rubric drives coarse retrieval.                             |
   | `bullet_group`  | **no**             | **no**            | Fully represented by child `bullet` content vectors; summary would duplicate. |
   | `paragraph`     | no                 | no (leaf)         | Leaf or split into `sentence_part`; content is embedded directly.         |
   | `sentence_part` | no                 | no (leaf)         | Leaf; content is embedded directly.                                       |
   | `bullet`        | no                 | no (leaf)         | Leaf; content is embedded directly.                                       |

   This formalizes and extends the leaf-behavior rule in [WKF-1](../features/WKF-1.md). See [ADR-013](ADR-013-structured-note-summaries.md) for the summary prompt shape at the retained levels.

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
- [ADR-013-structured-note-summaries.md](./ADR-013-structured-note-summaries.md) — summary prompt rubric for `note`/`topic`/`subtopic`
- [ADR-012-hybrid-retrieval-and-coarse-k.md](./ADR-012-hybrid-retrieval-and-coarse-k.md) — how coarse retrieval consumes summary vectors
