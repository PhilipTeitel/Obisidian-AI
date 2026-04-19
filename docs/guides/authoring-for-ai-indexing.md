# Authoring notes for better semantic search and chat

This guide explains how everyday Obsidian writing habits affect **hierarchical indexing** (see [README — Hierarchical model](../README.md#4-hierarchical-document-model) and [ADR-002](../decisions/ADR-002-hierarchical-document-model.md)). It satisfies the product requirement for **user-facing documentation** on how structure influences retrieval ([REQUIREMENTS §5 — User-facing documentation](../requirements/REQUIREMENTS.md)).

## Headings

- **Outline hierarchy:** `#` / `##` / `###` (and deeper) define **topics and subtopics** in the index tree. Clear headings give the chunker **heading trails** so search snippets and chat context can show _where_ in the note a passage lived.
- **Skipping headings:** Long runs of body text without headings still index as paragraphs under the note root, but you lose navigable structure for coarse retrieval.

## Paragraphs and bullets

- **Paragraphs** become leaf-ish **content nodes** (with sentence splitting when text exceeds embedding limits).
- **Consecutive bullets** without a blank line form a **bullet group**; nested indentation forms **nested bullets**. That structure is preserved so retrieval can return a sensible list fragment instead of unrelated one-line chips.

## Tags

- **Frontmatter tags** and **inline `#tags`** are collected and associated with structural nodes. Tags help **filter** search when you use tag filters in the product.

## Wikilinks and references

- Explicit **`[[links]]`** (and similar) are extracted as **cross-references**. They support related-context ideas in retrieval (pulling in linked notes when the pipeline uses them).

## Practical habits

1. Use headings to segment ideas you might want to find independently later.
2. Keep bullet lists **contiguous** when they belong together; use a blank line when you start a new list or topic.
3. Prefer explicit links between notes you want treated as related knowledge.

## Limits

- Very large paragraphs are split on **sentence boundaries** for embedding size; the indexer preserves order so meaning stays recoverable.

---

_Part of Epic 10 (DOC-1)._
