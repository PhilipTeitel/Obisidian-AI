# ADR-014: Temporal and path filters in retrieval

**Status:** Accepted  
**Date:** 2026-04-16

---

## Context

Users store time-organized content in their vaults — daily notes, weekly reviews, meeting notes, journal entries — whose filenames encode dates (`Daily/2026-02-14.md`, `Meetings/2026-02-14 - Team sync.md`). Natural language queries commonly scope by time ("my job-search activities over the last two weeks", "what meetings did I have last month?") or by location ("only look at my work vault folder", "ignore the research project").

Today, retrieval has no first-class way to honor these scopes. Workflows either dump everything to the LLM and hope it ignores the irrelevant parts, or users manually paste the content they care about — precisely the failure mode [ADR-011](ADR-011-vault-only-chat-grounding.md) is eliminating. Even with hybrid retrieval ([ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)) and structured summaries ([ADR-013](ADR-013-structured-note-summaries.md)), semantic/keyword matches for "last two weeks" will not consistently filter by calendar date — dates do not tokenize predictably and embeddings conflate "Feb 2024" with "Feb 2026".

`SearchRequest` already accepts an optional `tags` filter ([RET-3](../features/RET-3.md)); adding path/date filters is the same pattern.

---

## Decision

1. **`SearchRequest` gains two optional fields.**

   ```ts
   export interface SearchRequest {
     query: string;
     k?: number;
     apiKey?: string;
     tags?: string[];        // existing
     pathGlobs?: string[];   // new — e.g. ['Daily/**/*.md', 'Journal/**/*.md']
     dateRange?: {           // new — inclusive ISO range
       start?: string;       // 'YYYY-MM-DD'
       end?: string;         // 'YYYY-MM-DD'
     };
   }
   ```

   Both fields are **optional** and **non-breaking**; omitting them preserves current behavior.

2. **`pathGlobs` semantics.** When present and non-empty, retrieval is restricted to nodes whose owning `note_meta.vault_path` matches at least one glob. Globs use standard `**` / `*` / `?` semantics. Internally, globs are compiled to a `LIKE`/regex filter pushed into `searchSummaryVectors`, `searchContentVectors`, and the new `searchContentKeyword` from [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md) as a pre-filter **before** ANN scoring where the store supports it (SQL `WHERE` clause); otherwise a post-filter.

3. **`dateRange` semantics.** When present, retrieval is restricted to notes whose parsed filename date falls in `[start, end]` (inclusive on both ends; either endpoint may be omitted for open-ended ranges). The filter is applied to `note_meta` rows (joined via `nodes.note_id`) before ANN.

4. **Daily-note filename parsing.**
   - Plugin settings gain `dailyNotePathGlobs: string[]` (default `['Daily/**/*.md']`) and `dailyNoteDatePattern: string` (default `'YYYY-MM-DD'`).
   - When a note's `vault_path` matches one of the configured daily-note globs and its filename (minus extension) matches `dailyNoteDatePattern`, the parsed date is persisted in a new `note_meta.note_date TEXT NULL` column (migration-additive).
   - `dateRange` filtering uses `note_meta.note_date`. Notes without a parsed `note_date` are **excluded** when `dateRange` is set, **included** when only `pathGlobs` (or neither) is set.
   - Pattern tokens supported in MVP: `YYYY`, `MM`, `DD`. Richer patterns (ISO weeks, locale months) are out of scope.

5. **Chat workflow exposes filters.** `ChatWorkflow` (and the sidecar `chat` route) accept the same optional filters in the chat payload. The plugin UI story for exposing this affordance is deferred to a later RET/UI story; the **transport + workflow** surface area ships with [RET-6](../features/RET-6.md). In the meantime, prompts and programmatic consumers (tests, CLI) can exercise the path.

6. **Interplay with the content-only fallback.** The unrestricted `vec_content` fallback from [ADR-012 §2](ADR-012-hybrid-retrieval-and-coarse-k.md) still respects `pathGlobs` and `dateRange` filters — "unrestricted" means "no subtree-root filter", not "no user filter".

7. **No domain-model changes.** Filters live on `SearchRequest` and `NodeFilter`; the hierarchical document model ([ADR-002](ADR-002-hierarchical-document-model.md)) is untouched.

---

## Consequences

**Positive**

- Queries like "last two weeks of daily notes" produce bounded, relevant candidate sets — no more relying on the LLM to eyeball dates in summaries.
- Users can scope chat to a subset of their vault ("only look under `Work/`") without reindexing or using a separate vault.
- Filters are pushed down, not post-processed, so large vaults stay fast.

**Negative / costs**

- Additional `note_meta` column and an extra index on `(note_date)`; migration-additive but requires a reindex for backfill.
- `pathGlobs` regex/`LIKE` translation is implementation detail that must be correct across platforms (especially Windows `\` vs `/`).
- One more set of knobs in settings (globs, date pattern) users must understand; guide updates cover this.

---

## Alternatives considered

| Alternative                                                              | Why not chosen                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Let the LLM parse dates out of query and self-filter                     | Unreliable; relies on model behavior and wastes retrieval budget. Doesn't push down, so large vaults still return too much.     |
| Store dates as tags and use existing tag filter                          | Forces users to author `#2026-02-14` tags, which defeats the point of daily-note conventions they already use.                   |
| Separate retrieval endpoints for temporal queries                        | Multiplies surface area; most queries mix temporal + semantic ("what job-search things did I do last week?").                    |
| Full cron-like date expression parser ("last Tuesday", "Q1")             | Out of scope for MVP; start with explicit ISO ranges; callers can compute `start`/`end` from natural language upstream.          |

---

## Explicit non-decisions

- This ADR does **not** define UI affordances in `SearchView` or `ChatView`; those come in later UI stories.
- This ADR does **not** specify natural-language date parsing ("last two weeks" → ISO range); callers supply `start`/`end`. A later story may add a helper.
- This ADR does **not** add per-glob date patterns; one vault-wide `dailyNoteDatePattern` is used per [REQUIREMENTS §15](../requirements/REQUIREMENTS.md) open question.
- This ADR does **not** cover date parsing for non-daily notes (meeting note date prefixes, journal entries without standardized filenames). Those rely on content matching (hybrid retrieval) plus in-content date mentions.

---

## Links

- Requirements: [REQUIREMENTS §5](../requirements/REQUIREMENTS.md), [§7](../requirements/REQUIREMENTS.md), [§15](../requirements/REQUIREMENTS.md)
- Related README sections: [§8 SQLite Schema](../../README.md#8-sqlite-schema), [Plugin Settings](../../README.md#plugin-settings)
- Related ADRs: [ADR-003](ADR-003-phased-retrieval-strategy.md), [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)
- Related stories: [RET-3](../features/RET-3.md), RET-6, STO-4
