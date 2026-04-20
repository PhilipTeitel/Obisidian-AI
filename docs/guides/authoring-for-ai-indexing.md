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

## Daily notes and dated filenames

If you keep daily notes in a folder like `Daily/` with dated filenames (e.g. `Daily/2026-04-16.md`), the indexer parses the date from the filename and stores it as `note_meta.note_date`. That unlocks temporal filtering in chat — for example, asking for "what I worked on last week" can be scoped to the matching date range rather than semantically rediscovered across the entire vault. Defaults:

- Folders treated as daily notes: `['Daily/**/*.md']` (setting: `dailyNotePathGlobs`).
- Filename date pattern: `YYYY-MM-DD` (setting: `dailyNoteDatePattern`).

Both are configurable in **Settings → AI MVP → Advanced retrieval** when your layout differs.

You can also scope any question explicitly with slash-command-style filters in the chat input, e.g. `path:Projects/** last:14d what are the open questions for Acme?`. See [chat-behavior-tuning.md](chat-behavior-tuning.md) for full examples.

## Limits

- Very large paragraphs are split on **sentence boundaries** for embedding size; the indexer preserves order so meaning stays recoverable.
- Summaries are generated for `note`, `topic`, and `subtopic` nodes only. Bullets inside a bullet group are still searched — they just contribute content-level vectors rather than their own summary (see [ADR-013](../decisions/ADR-013-structured-note-summaries.md)). Keep important names, dates, and actions in prose under a heading when you want them to surface in coarse retrieval.

## Telling the assistant how your vault is organized

Structure in your notes helps the indexer; a short **vault organization prompt** in plugin settings helps the chat assistant _target_ that structure. See [chat-behavior-tuning.md](chat-behavior-tuning.md) for examples (daily notes with dated filenames, tag conventions, folder layouts).

---

_Part of Epic 10 (DOC-1)._
