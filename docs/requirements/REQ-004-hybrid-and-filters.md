# REQ-004: Hybrid retrieval and temporal / path filters

**Source material:**

- [`docs/requirements/REQUIREMENTS.md`](REQUIREMENTS.md) — §5 (Retrieval — hybrid retrieval, temporal and path filters, content-only fallback), §7 (Settings — `enableHybridSearch`, `dailyNotePathGlobs`, `dailyNoteDatePattern`), §8 (Storage — FTS5 as additive migration), §10 (Chat UX, insufficient-evidence state), §15 (Open questions — RRF weighting, daily-note date parsing strategy).
- [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) — Accepted. Binding ADR for FTS5 + reciprocal-rank-fusion hybrid retrieval and the `enableHybridSearch` toggle.
- [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) — Accepted. Binding ADR for `pathGlobs`, `dateRange`, and daily-note filename parsing.
- [`docs/features/RET-5.md`](../features/RET-5.md) — in-flight story for hybrid retrieval; consulted only for scope.
- [`docs/features/RET-6.md`](../features/RET-6.md) — in-flight story for temporal and path filters; consulted only for scope.
- [`docs/guides/authoring-for-ai-indexing.md`](../guides/authoring-for-ai-indexing.md) — user-facing description of daily notes and slash-command filters in chat input.
- [`docs/requirements/REQ-001-grounding-policy.md`](REQ-001-grounding-policy.md) — cross-referenced for the insufficient-evidence handoff when filters collapse results to zero.

**Date:** 2026-04-20
**Status:** Draft

---

## 1. Goals

Each goal traces to a line in the source material cited inline.

- **Improve recall on exact-keyword queries** (proper nouns, dates as tokens, tag-like words, code identifiers) by fusing a BM25 keyword index with the existing vector index during the coarse retrieval phase. (REQUIREMENTS §5 *"Hybrid retrieval (iter-2) … combining vector search over summary/content embeddings with keyword/BM25 search over node content (SQLite FTS5). Results are merged via a documented fusion strategy (e.g. reciprocal rank fusion)"*; ADR-012 Context, Decision 3, Decision 4.)
- **Let the user toggle hybrid retrieval on or off**, so vaults or workflows where the baseline vector-only behavior is preferred can opt out without config surgery. (REQUIREMENTS §7 *"`enableHybridSearch` — toggle for keyword (FTS5) + vector recall fusion"*; ADR-012 Decision 5.)
- **Let the user scope a query to a subset of their vault by folder / path pattern**, so "only look under `Work/`" or "only daily notes" is a first-class filter rather than a prompt-time suggestion the LLM may ignore. (REQUIREMENTS §5 *"`SearchRequest` must accept optional path globs (e.g. `Daily/**/*.md`) … Filters are pushed down to SQLite before ANN scoring where possible"*; ADR-014 Decision 1, Decision 2.)
- **Let the user scope a query to a date range**, so questions like "what did I do in the last two weeks?" are answered from notes whose own date metadata falls in that range, not from whatever the model guesses from prose. (REQUIREMENTS §5 *"… and date ranges (ISO start/end). For daily-note vaults, filenames of the form `YYYY-MM-DD.md` are parsed into dates"*; ADR-014 Decision 3, Decision 4.)
- **Teach the indexer to recognize daily-note files and store their date**, so temporal filtering works without asking the user to tag or retag their notes. (REQUIREMENTS §7 *"`dailyNotePathGlobs` … `dailyNoteDatePattern`"*; ADR-014 Decision 4; `authoring-for-ai-indexing.md` §"Daily notes and dated filenames".)
- **Expose filters from the chat input**, so a user can scope a single question ("path:Daily/** last:14d what are the open questions for Acme?") without opening settings. (REQUIREMENTS §5 *"User-facing documentation"* and §8 chat payload filter contract; `authoring-for-ai-indexing.md` §"Daily notes and dated filenames" *"You can also scope any question explicitly with slash-command-style filters in the chat input"*.)

## 2. Non-goals

- **Not defining UI affordances beyond chat slash-command parsing.** A dedicated scope picker, date picker, or results-scope chips in `SearchView` / `ChatView` are deferred. (ADR-014 *Explicit non-decisions* *"This ADR does not define UI affordances in `SearchView` or `ChatView`; those come in later UI stories"*.)
- **Not defining a natural-language date parser** ("last Tuesday", "Q1 2026"). Callers supply explicit ISO `start` and `end` endpoints; a helper is optional future work. (ADR-014 *Explicit non-decisions* *"This ADR does not specify natural-language date parsing … callers supply start/end"*.)
- **Not introducing user-tunable fusion weights.** RRF uses the fixed constant `k = 60` per ADR-012; whether weights should be tunable is tracked as an open question at the REQUIREMENTS level but is out of scope for MVP. (REQUIREMENTS §15 *"Hybrid retrieval weighting … Default assumption: fixed in MVP"*; ADR-012 Decision 4 and *Explicit non-decisions* *"RRF weights are fixed in MVP"*.)
- **Not changing Phase 2 drill-down to use BM25.** Phase 2 continues to run against content vectors only; hybrid fusion is a coarse-phase concern. (ADR-012 *Explicit non-decisions* *"This ADR does not define a reranker step; candidates feed Phase 2 directly"*; RET-5 Binding constraint Y5.)
- **Not supporting per-glob date patterns.** One vault-wide `dailyNoteDatePattern` is used for all daily-note globs in MVP. (ADR-014 *Explicit non-decisions* *"This ADR does not add per-glob date patterns; one vault-wide `dailyNoteDatePattern` is used"*; REQUIREMENTS §15.)
- **Not supporting rich date-pattern tokens** (ISO weeks, locale-specific month names). Only `YYYY`, `MM`, and `DD` tokens are recognized in MVP. (ADR-014 Decision 4 *"Pattern tokens supported in MVP: YYYY, MM, DD. Richer patterns (ISO weeks, locale months) are out of scope"*.)
- **Not parsing dates out of non-daily-note filenames** (e.g. `Meetings/2026-02-14 - Team sync.md`). Those rely on content matching plus any in-content date mentions. (ADR-014 *Explicit non-decisions* *"This ADR does not cover date parsing for non-daily notes"*.)
- **Not changing the grounding policy or the insufficient-evidence response.** Zero-result outcomes after filtering are handed off to the existing policy from [REQ-001](REQ-001-grounding-policy.md). (ADR-012 *Explicit non-decisions*; REQ-001 constraints.)
- **Not tokenizing FTS5 beyond `unicode61` with diacritic folding.** Language-specific or stemming tokenizers are later improvements. (ADR-012 *Explicit non-decisions* *"This ADR does not define `nodes_fts` tokenizer details beyond unicode61 with diacritic folding"*.)

## 3. Personas / actors

- **Daily-note keeper** — an Obsidian user whose vault is organized around per-day notes in `Daily/` with `YYYY-MM-DD.md` filenames (journals, daily logs, job-search tracking). They frequently ask time-scoped questions ("what meetings did I have last week?", "summarize my job-search activities for the past two weeks"). They expect retrieval to honor those time boundaries, not paraphrase them. (REQUIREMENTS §5 *"For daily-note vaults, filenames of the form `YYYY-MM-DD.md` are parsed into dates"*; `authoring-for-ai-indexing.md` §"Daily notes and dated filenames"; ADR-014 Context.)
- **Large-vault owner scoping by folder** — an Obsidian user whose vault contains multiple distinct projects or topics (work notes, research notes, personal notes) and who wants to constrain a question to one area ("only look under `Work/`"). They expect a path-based filter to take immediate effect rather than hoping the model filters the right way. (REQUIREMENTS §5; ADR-014 Context *"Users … want to scope chat to a subset of their vault ('only look under Work/', 'ignore the research project')"*.)
- **Power user of exact-keyword queries** — an Obsidian user whose questions hinge on exact tokens (company names like "Acme Corp", dates like `2026-02-14`, tag-like strings like `#jobsearch`, code identifiers) that cosine similarity over dense prose tends to miss. They expect hybrid retrieval to surface those notes where vector-only previously missed. (REQUIREMENTS §5 *"Hybrid retrieval (iter-2)"*; ADR-012 Context *"Exact-keyword queries … often fail on cosine similarity when the surrounding note prose dilutes the signal"*.)

## 4. User scenarios (Gherkin)

Each scenario has an `Sn` ID and a final `Implemented by:` annotation listing the stories that cover it. Story authors cite these IDs in their Test Plans; the `Implemented by:` annotation is the mitigation for the "Sn drift" risk when a REQ fans out to multiple stories.

### S1 — Hybrid on: BM25 and vector hits merged via RRF

```gherkin
Given the user has indexed their vault
And   the setting `enableHybridSearch` is true
When  the user submits a query (via the chat pane or the semantic search pane)
Then  the coarse retrieval phase runs both a BM25 keyword search over the FTS5 index and a vector ANN search over summary embeddings
And   the two ranked lists are merged via reciprocal rank fusion to produce a single ranked candidate set
And   that merged candidate set drives the subsequent drill-down / assembly phase
```

*Traces to:* REQUIREMENTS §5 *"Retrieval must support hybrid recall … merged via a documented fusion strategy (e.g. reciprocal rank fusion)"*; ADR-012 Decision 3, Decision 4.
**Implemented by: RET-5, STO-4**

### S2 — Hybrid off: vector-only baseline parity

```gherkin
Given the user has indexed their vault
And   the setting `enableHybridSearch` is false
When  the user submits a query
Then  the coarse retrieval phase runs the vector ANN search only
And   no BM25 / FTS5 query is issued for that request
And   the resulting ranking matches the pre-hybrid vector-only baseline behavior
```

*Traces to:* REQUIREMENTS §7 *"`enableHybridSearch` — toggle for keyword (FTS5) + vector recall fusion"*; ADR-012 Decision 5 *"Toggleable. Hybrid retrieval is gated by a user setting `enableHybridSearch` … When disabled, the workflow runs vector-only and neither the FTS5 query nor the RRF merge runs"*.
**Implemented by: RET-5**

### S3 — RRF uses the fusion constant fixed by ADR-012

```gherkin
Given hybrid retrieval is enabled
When  the workflow merges the two ranked lists
Then  it uses reciprocal rank fusion with the constant value specified by ADR-012
And   no per-list weighting parameter is exposed to the user or to callers in MVP
```

*Traces to:* ADR-012 Decision 4 (RRF formula with `k = 60`); REQUIREMENTS §15 *"Hybrid retrieval weighting … fixed in MVP"*.
**Implemented by: RET-5**

### S4 — FTS5 is the keyword backend and lives in the per-vault SQLite database

```gherkin
Given the plugin has finished its database migrations
When  hybrid retrieval issues a keyword query
Then  the query is executed against a SQLite FTS5 virtual table mirroring the indexed node content
And   that FTS5 index is co-located in the same per-vault SQLite database as the vector and metadata tables
And   the FTS5 migration is additive (prior indexes continue to load; a full reindex is an acceptable upgrade path)
```

*Traces to:* REQUIREMENTS §8 *"Keyword index (iter-2): The same per-vault SQLite database must house a full-text search index (SQLite FTS5 virtual table over node content) … The FTS5 table is an additive migration; a full reindex is an acceptable upgrade path"*; ADR-012 Decision 3.
**Implemented by: STO-4, RET-5**

### S5 — A single pathGlob scopes the query to matching notes only

```gherkin
Given the user has indexed their vault
And   the vault contains notes at `Daily/2026-02-14.md`, `Work/projects.md`, and `Research/paper.md`
When  the user submits a query with `pathGlobs = ["Daily/**"]`
Then  the candidate set contains only nodes belonging to notes whose path matches `Daily/**`
And   nodes under `Work/` and `Research/` are absent from the candidate set
```

*Traces to:* REQUIREMENTS §5 *"`SearchRequest` must accept optional path globs (e.g. `Daily/**/*.md`)"*; ADR-014 Decision 2.
**Implemented by: RET-6**

### S6 — Multiple path globs are unioned

```gherkin
Given the user has indexed their vault
When  the user submits a query with `pathGlobs = ["Daily/**", "Journal/**"]`
Then  a note matching either glob is included in the candidate set
And   a note matching neither glob is excluded
```

*Traces to:* ADR-014 Decision 2 *"retrieval is restricted to nodes whose owning `note_meta.vault_path` matches at least one glob"*.
**Implemented by: RET-6**

### S7 — A dateRange restricts the query to notes whose note_date falls inside the range

```gherkin
Given the user has indexed their vault
And   `Daily/2026-01-05.md`, `Daily/2026-02-14.md`, and `Daily/2026-04-01.md` each have a parsed `note_date` matching their filename
When  the user submits a query with `dateRange = { start: "2026-02-01", end: "2026-02-28" }`
Then  the candidate set contains content from `Daily/2026-02-14.md`
And   the candidate set does not contain content from `Daily/2026-01-05.md` or `Daily/2026-04-01.md`
And   the range is inclusive on both endpoints
```

*Traces to:* REQUIREMENTS §5 *"date ranges (ISO start/end)"*; ADR-014 Decision 3 *"retrieval is restricted to notes whose parsed filename date falls in [start, end] (inclusive on both ends)"*.
**Implemented by: RET-6, STO-4**

### S8 — Notes without a parsed note_date are excluded when dateRange is set

```gherkin
Given the user has indexed their vault
And   some notes (e.g. ad-hoc notes outside the daily-note folders, or notes whose filename does not match the daily-note pattern) have `note_date = NULL`
When  the user submits a query with a non-empty `dateRange`
Then  notes with `note_date = NULL` are excluded from the candidate set
And   this exclusion applies even if those notes would otherwise match the query semantically
```

*Traces to:* ADR-014 Decision 3, Decision 4 *"Notes without a parsed `note_date` are excluded when `dateRange` is set"*.
**Implemented by: RET-6, STO-4**

### S9 — `dailyNotePathGlobs` and `dailyNoteDatePattern` determine which notes get a note_date

```gherkin
Given the user's settings are `dailyNotePathGlobs = ["Daily/**/*.md"]` and `dailyNoteDatePattern = "YYYY-MM-DD"`
And   the vault contains `Daily/2026-02-14.md`, `Daily/planning.md`, and `Work/2026-02-14.md`
When  indexing completes
Then  `Daily/2026-02-14.md` has `note_date = "2026-02-14"`
And   `Daily/planning.md` has `note_date = NULL` (basename does not match the date pattern)
And   `Work/2026-02-14.md` has `note_date = NULL` (path does not match any daily-note glob)
And   changing `dailyNotePathGlobs` or `dailyNoteDatePattern` and reindexing causes these values to be recomputed accordingly
```

*Traces to:* REQUIREMENTS §7 *"`dailyNotePathGlobs` — optional glob(s) identifying daily-note files for temporal filtering … `dailyNoteDatePattern` — date format embedded in daily-note filenames (default `YYYY-MM-DD`)"*; ADR-014 Decision 4.
**Implemented by: RET-6, STO-4**

### S10 — Combining pathGlobs and dateRange AND-intersects them

```gherkin
Given the user has indexed their vault
And   `Daily/2026-02-14.md` has a parsed `note_date`, `Journal/2026-02-14.md` has a parsed `note_date`, and `Daily/2026-04-01.md` has a parsed `note_date`
When  the user submits a query with `pathGlobs = ["Daily/**"]` and `dateRange = { start: "2026-02-01", end: "2026-02-28" }`
Then  the candidate set contains content from `Daily/2026-02-14.md`
And   the candidate set does not contain `Journal/2026-02-14.md` (path does not match)
And   the candidate set does not contain `Daily/2026-04-01.md` (date does not match)
```

*Traces to:* ADR-014 Decision 2 and Decision 3 (both filters are applied as predicates before ANN); `authoring-for-ai-indexing.md` §"Daily notes and dated filenames".
**Implemented by: RET-6**

### S11 — The user can apply filters from chat input and see them reflected in the effective query

```gherkin
Given the chat pane is open
When  the user submits a chat message whose input contains slash-command-style filter hints
      (for example a path hint like `path:Daily/**/*.md` and a temporal hint like `last:14d`)
Then  the plugin extracts those hints from the input before sending the request
And   the underlying chat request carries `pathGlobs` and `dateRange` derived from those hints
And   the freeform question text sent downstream no longer contains the raw filter hints
```

*Traces to:* REQUIREMENTS §5 *"User-facing documentation"* cross-references; `authoring-for-ai-indexing.md` §"Daily notes and dated filenames" *"You can also scope any question explicitly with slash-command-style filters in the chat input, e.g. `path:Projects/** last:14d what are the open questions for Acme?`"*; ADR-014 Decision 5 *"Chat workflow exposes filters … the plugin UI story for exposing this affordance"*.
**Implemented by: RET-6**

### S12 — When filters collapse the candidate set to zero, the grounding policy takes over

```gherkin
Given the user submits a query whose combined `pathGlobs` and/or `dateRange` match zero notes
When  the workflow runs coarse retrieval (hybrid or vector-only) and receives an empty candidate set
Then  the workflow hands off cleanly to the existing insufficient-evidence response defined by REQ-001 and ADR-011
And   no fabricated results, sources, or "answered from vault" chrome are produced for that request
And   the reply is visually distinct from a normal answered reply per the insufficient-evidence state
```

*Traces to:* REQUIREMENTS §1 MVP success criteria (insufficient-evidence enforcement); REQUIREMENTS §6 *"Grounding policy (non-optional)"*; REQUIREMENTS §10 *"Insufficient-evidence state (iter-2)"*; REQ-001 S2, S4.
**Implemented by: RET-5, RET-6**

### S13 — Hybrid retrieval surfaces an exact-keyword hit that vector-only retrieval would miss

```gherkin
Given the user has indexed their vault
And   a note mentions a specific entity (e.g. "Acme Corp", a `YYYY-MM-DD` date, or a tag-like token) amid enough surrounding prose that cosine similarity against a query for that entity ranks the note outside the coarse-phase candidate cutoff
And   `enableHybridSearch` is true
When  the user submits a query consisting of (or containing) that entity token
Then  the BM25 keyword leg returns that note at a high rank
And   the RRF fusion places the note inside the coarse-phase candidate cutoff
And   the note is reachable by the drill-down / assembly phase and may appear in the final result set
```

*Traces to:* ADR-012 Context *"Exact-keyword queries (proper nouns, dates, tag-like tokens, code identifiers) often fail on cosine similarity when the surrounding note prose dilutes the signal. Hybrid retrieval (keyword + vector, fused) is a standard fix"*.
**Implemented by: RET-5**

### S14 — Filters are still respected when the content-only fallback fires

```gherkin
Given the user submits a query with `pathGlobs` and/or `dateRange` set
And   hybrid retrieval is in use
And   the coarse phase returns fewer usable summary hits than the configured floor, triggering the content-only fallback defined in ADR-012
When  the fallback runs its unrestricted content-vector ANN
Then  the fallback still applies the user's `pathGlobs` and `dateRange` predicates
And   "unrestricted" means the subtree-root filter is dropped, not that the user's scope filters are dropped
And   out-of-scope notes are absent from the fallback candidate set
```

*Traces to:* ADR-012 Decision 2 (content-only fallback); ADR-014 Decision 6 *"The unrestricted `vec_content` fallback from ADR-012 §2 still respects `pathGlobs` and `dateRange` filters — 'unrestricted' means 'no subtree-root filter', not 'no user filter'"*.
**Implemented by: RET-5, RET-6**

### S15 — The coarse-phase BM25 leg is restricted to summary-bearing node types

```gherkin
Given hybrid retrieval is enabled
When  the workflow issues its coarse-phase BM25 query
Then  the BM25 query is restricted to node types that carry summary-level signal (note / topic / subtopic)
And   bullet and paragraph leaves are not returned by the coarse-phase BM25 query
And   drill-down (Phase 2) is free to reach those leaves via the content-vector path
```

*Traces to:* ADR-012 Decision 4 *"BM25 keyword hits (from `nodes_fts` restricted to `type IN ('note','topic','subtopic')` for the coarse phase; all node types for the drill-down phase)"*.
**Implemented by: RET-5**

## 5. Constraints

- **Hybrid retrieval is bound by ADR-012.** FTS5 is the keyword backend; fusion is reciprocal rank fusion with the fixed constant from ADR-012; the toggle is `enableHybridSearch` and its default is on. (ADR-012 Decisions 3–5; REQUIREMENTS §5, §7.)
- **Temporal / path filtering is bound by ADR-014.** `pathGlobs` is a list of glob patterns matched against each note's vault path; `dateRange` is an ISO-date inclusive range matched against `note_meta.note_date`. Omitting either field preserves prior behavior. (ADR-014 Decisions 1–3; REQUIREMENTS §5.)
- **Filters are pushed down before ANN scoring where the store supports it.** Both `pathGlobs` and `dateRange` must be applied as SQL predicates during coarse-phase BM25 and vector queries, during the content-vector drill-down, and during the content-only fallback — not post-processed after ranking. (REQUIREMENTS §5 *"Filters are pushed down to SQLite before ANN scoring where possible"*; ADR-014 Decision 2, Decision 6.)
- **Combining filters is intersection.** When both `pathGlobs` and `dateRange` are set, a note must satisfy both to be eligible. (ADR-014 Decision 2 and Decision 3, applied together.)
- **Multiple globs are union.** Within `pathGlobs` alone, a note matching any glob qualifies. (ADR-014 Decision 2 *"matches at least one glob"*.)
- **Daily-note detection is driven by settings, not by filesystem heuristics.** A note gets a `note_date` only when (a) its path matches one of `dailyNotePathGlobs` and (b) its filename (minus extension) matches `dailyNoteDatePattern`. Other notes' `note_date` is NULL. (ADR-014 Decision 4; REQUIREMENTS §7.)
- **NULL `note_date` is excluded from any `dateRange` filter.** This is the only defensible semantics for a "does not have a date" value relative to a bounded range. (ADR-014 Decision 3 *"Notes with NULL `note_date` are excluded when `dateRange` is set"*.)
- **FTS5 migration is additive; a full reindex is an acceptable upgrade path.** Existing vector data is not invalidated; users may be prompted to reindex to populate FTS5 and `note_date`. (REQUIREMENTS §8; ADR-012 Decision 3.)
- **Phase 2 drill-down does not use BM25.** Hybrid fusion operates only in the coarse phase in MVP. (ADR-012 Decision 4, *Explicit non-decisions*; RET-5 Y5.)
- **One vault-wide daily-note date pattern.** Per-glob date patterns are not part of MVP. (REQUIREMENTS §15; ADR-014 *Explicit non-decisions*.)
- **Date-pattern tokens are restricted to `YYYY`, `MM`, `DD`.** Richer tokens are not part of MVP. (ADR-014 Decision 4.)
- **Zero-result outcomes after filtering hand off to the grounding policy from REQ-001.** This REQ does not introduce a separate empty-result UI; the existing insufficient-evidence response covers it. (REQUIREMENTS §1, §6, §10; REQ-001 S2, S4.)
- **Chat and search honor the same retrieval settings.** Both code paths must apply `enableHybridSearch`, `pathGlobs`, `dateRange`, `dailyNotePathGlobs`, and `dailyNoteDatePattern` consistently. (REQUIREMENTS §6 *"Retrieval configuration is honored by chat"*; ADR-012 Decision 6 *"No chat-vs-search divergence"*.)

## 6. Resolved questions

These questions were raised in earlier scoping (REQUIREMENTS §15 and the ADR-012 / ADR-014 decision processes) and are already answered by the source material. They are captured here so downstream stories do not re-open them.

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| 1 | What is the keyword backend for hybrid retrieval? | SQLite FTS5 virtual table over indexed node content, co-located in the per-vault SQLite database. | REQUIREMENTS §5, §8; ADR-012 Decision 3 |
| 2 | What fusion algorithm merges keyword and vector rankings? | Reciprocal rank fusion with the fixed constant `k = 60`. | ADR-012 Decision 4 |
| 3 | Are RRF weights user-tunable in MVP? | No. Fixed in MVP; revisit later based on retrieval-quality telemetry. | REQUIREMENTS §15; ADR-012 *Explicit non-decisions* |
| 4 | Is hybrid retrieval on by default? | Yes. `enableHybridSearch` defaults to true; users may disable it. | REQUIREMENTS §7; ADR-012 Decision 5 |
| 5 | When `enableHybridSearch` is false, does BM25 still run? | No. The BM25 query and the RRF merge are both skipped; coarse retrieval is pure vector. | ADR-012 Decision 5 |
| 6 | Does the BM25 coarse leg query all node types? | No. Coarse BM25 is restricted to summary-bearing types (`note`, `topic`, `subtopic`). Drill-down is not affected because Phase 2 is vector-only. | ADR-012 Decision 4 |
| 7 | Does Phase 2 drill-down use BM25? | No. Phase 2 is vector-only in MVP. | ADR-012 *Explicit non-decisions*; RET-5 Y5 |
| 8 | Does the content-only fallback still honor `pathGlobs` and `dateRange`? | Yes. "Unrestricted" in the fallback means the subtree-root filter is dropped, not the user's scope filters. | ADR-014 Decision 6 |
| 9 | What glob semantics does `pathGlobs` use? | Standard `**` / `*` / `?` semantics; `**` matches any number of path segments, `*` matches a single segment, `?` matches a single non-separator character. A note matching any glob in the list qualifies. | ADR-014 Decision 2; RET-6 Y2 |
| 10 | What is the `dateRange` inclusivity? | Inclusive on both `start` and `end`. Either endpoint may be omitted for an open-ended range. | ADR-014 Decision 3 |
| 11 | How are notes without a parsed date treated when a `dateRange` is set? | Excluded. NULL is not a member of any range. | ADR-014 Decision 3 and Decision 4 |
| 12 | Which notes get a parsed `note_date`? | Notes whose path matches `dailyNotePathGlobs` AND whose basename matches `dailyNoteDatePattern`. Notes that match neither, or match the glob but not the pattern, remain NULL. | ADR-014 Decision 4; REQUIREMENTS §7 |
| 13 | Are there separate date patterns per glob? | No. One vault-wide `dailyNoteDatePattern` in MVP. | REQUIREMENTS §15; ADR-014 *Explicit non-decisions* |
| 14 | Which date-pattern tokens are supported? | `YYYY`, `MM`, and `DD` only. | ADR-014 Decision 4 |
| 15 | What happens when filters reduce the result set to zero? | The existing insufficient-evidence response (REQ-001, ADR-011) fires; no separate empty-state flow is introduced. | REQ-001 S2, S4; REQUIREMENTS §6, §10 |
| 16 | Do chat and search share the same retrieval settings? | Yes. Both route through the same retrieval options; divergence is explicitly disallowed. | REQUIREMENTS §6; ADR-012 Decision 6 |
| 17 | Do non-daily notes (e.g. `Meetings/2026-02-14 - Team sync.md`) get a parsed `note_date`? | No. Date parsing is driven by `dailyNotePathGlobs` + `dailyNoteDatePattern` only. Non-daily notes rely on content matching. | ADR-014 *Explicit non-decisions* |
| 18 | Is there a separate "empty-result after filter" reply or UI? | No. It routes into the same insufficient-evidence reply; this REQ does not add a new UI state. | REQ-001; REQUIREMENTS §10 |

## 7. Open questions

These are not resolved by the source material and block downstream design or story planning for the areas they touch.

- [ ] **Slash-command syntax for chat input filters.** The authoring guide shows informal phrasing like *"past 2 weeks"* and `@Daily/**`, while [RET-6](../features/RET-6.md) §6b lists `path:`, `since:`, `before:`, and `last:14d`. The exact user-visible slash-command grammar for MVP (which prefixes, which tokens, which aliases) is not locked in. Needed before story wording for S11 can specify literal inputs. (`authoring-for-ai-indexing.md`; RET-6 §6b.)
- [ ] **UX for chat-input filter parse failures.** RET-6 §6c lists states like "Glob parse failure: show inline warning in chat, send query unfiltered" and "Date parse failure: same", but neither the requirements nor ADR-014 mandates this behavior. The product decision — silently drop the filter with a warning vs. refuse to send the query vs. highlight the offending token inline — is open.
- [ ] **Whether the insufficient-evidence reply should echo active filters back to the user.** REQ-001 S8 / Open-question #2 already flags *"how concretely it lists what was searched"*; when filters are active, the reply arguably must at least acknowledge them ("I searched your `Daily/**` notes between 2026-02-01 and 2026-02-28 and found nothing that answers this"), but the required level of detail is not settled.
- [ ] **Windows path-separator behavior.** ADR-014 *Consequences* flags cross-platform correctness as an implementation concern ("especially Windows `\` vs `/`") but does not define whether the user sees globs in forward-slash form uniformly or whether the plugin accepts backslashes. A user-visible contract for how globs are written on Windows is not part of the source material.
- [ ] **Per-request `enableHybridSearch` override.** ADR-012 Decision 5 treats hybrid as a settings-level toggle; whether a single chat/search request may override it (e.g. a future "force keyword only" slash command) is not explicitly rejected but also not requested anywhere. Treat as settings-only until a requirement demands otherwise.

## 8. Suggested ADR triggers

Both binding ADRs for this feature already exist and are **Accepted**. Downstream stories must reference them in their Linked ADRs and Binding constraints sections. No new ADRs are proposed by this REQ.

| Trigger | Why it likely needs an ADR | Related Sn |
|---------|----------------------------|------------|
| Hybrid retrieval (FTS5 + RRF) and the `enableHybridSearch` toggle. **Already satisfied by [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) (Accepted, 2026-04-16)** — do not propose a new ADR. | Long-lived constraint on schema (additive FTS5 virtual table + triggers), retrieval algorithm (coarse-phase fusion by RRF with fixed `k`), and how a user-facing toggle routes through every workflow. Easy to silently regress if not bound by ADR. ADR-012 also binds the content-only fallback and the "no chat-vs-search divergence" rule. | S1, S2, S3, S4, S13, S14, S15 |
| Temporal and path filters on `SearchRequest` / chat retrieval options, including daily-note filename parsing. **Already satisfied by [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) (Accepted, 2026-04-16)** — do not propose a new ADR. | Long-lived constraint on the `SearchRequest` shape (new optional fields), on schema (`note_meta.note_date` column + index, populated at index time from settings-driven globs and patterns), and on filter push-down semantics (pre-ANN SQL predicates, NULL exclusion, AND-intersection with other filters). Easy to diverge between Phase 1 and Phase 2 or the content-only fallback if not bound. | S5, S6, S7, S8, S9, S10, S11, S12, S14 |

## 9. Links

- Source material: see header.
- Related REQ files: [REQ-001 — Always-on vault-only chat grounding and insufficient-evidence response](REQ-001-grounding-policy.md) (cross-referenced for the zero-result handoff in S12).
- Related ADRs (already exist): [ADR-012 — Hybrid retrieval and configurable coarse-K](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) (Accepted); [ADR-014 — Temporal and path filters](../decisions/ADR-014-temporal-and-path-filters.md) (Accepted). Indirectly referenced: [ADR-002 — Hierarchical document model](../decisions/ADR-002-hierarchical-document-model.md), [ADR-003 — Phased retrieval strategy](../decisions/ADR-003-phased-retrieval-strategy.md), [ADR-011 — Vault-only chat grounding](../decisions/ADR-011-vault-only-chat-grounding.md).
- Related in-flight stories: [RET-5](../features/RET-5.md), [RET-6](../features/RET-6.md); schema enabler [STO-4](../features/STO-4.md) (consulted only for scope).
- Related user guide: [`docs/guides/authoring-for-ai-indexing.md`](../guides/authoring-for-ai-indexing.md).

---

*Created: 2026-04-20 | Refined by: architect in Discovery Mode*
