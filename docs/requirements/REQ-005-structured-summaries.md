# REQ-005: Structured note / topic / subtopic summaries and `bullet_group` skip

**Source material:**

- [`docs/requirements/REQUIREMENTS.md`](REQUIREMENTS.md) — §5 Hierarchical indexing and retrieval (*"Summaries and embeddings"*, *"Structured note/topic summaries (iter-2)"*, *"Selective summary embeddings (iter-2)"*), §15 Open questions.
- [`docs/decisions/ADR-013-structured-note-summaries.md`](../decisions/ADR-013-structured-note-summaries.md) — **Accepted**. Binding ADR for the structured rubric and the `bullet_group` skip.
- [`docs/decisions/ADR-002-hierarchical-document-model.md`](../decisions/ADR-002-hierarchical-document-model.md) — amended *"Summary-embedding node-type policy (iter-2)"* table authoritatively listing which node types produce a summary vector.
- [`docs/features/WKF-4.md`](../features/WKF-4.md) — in-flight story describing the same feature technically; consulted for scope only.
- [`docs/features/STO-4.md`](../features/STO-4.md) — migration story; consulted for scope only (adds `summaries.prompt_version` column and backfill).
- [`docs/guides/authoring-for-ai-indexing.md`](../guides/authoring-for-ai-indexing.md) — user-facing guide; used to identify the user-visible promise ("Summaries are generated for `note`, `topic`, and `subtopic` nodes only … Bullets inside a bullet group are still searched — they just contribute content-level vectors").

**Date:** 2026-04-20
**Status:** Draft

---

## 1. Goals

Each goal traces to a line in the source material cited inline.

- **Make coarse retrieval hit entity- and date-specific queries on heterogeneous notes** (daily notes, topic dumps, MOC-style index notes) by replacing free-prose `note`/`topic`/`subtopic` summaries with a **breadth-preserving structured rubric** covering topics, entities, dates/times, actions/decisions, and tags. (REQUIREMENTS §5 *"Structured note/topic summaries (iter-2)"*; ADR-013 Context and Decision 1.)
- **Stop diluting the coarse-phase summary corpus with redundant vectors** by skipping summary generation *and* summary embedding for `bullet_group` nodes, whose signal is already carried by their `bullet` children's content embeddings. (REQUIREMENTS §5 *"Selective summary embeddings (iter-2)"*; ADR-002 summary-embedding node-type policy; ADR-013 Decision 3.)
- **Keep individual bullet content retrievable** even when its `bullet_group` parent has no summary vector, so breadth-preservation at the summary layer does not sacrifice fine-grained recall. (ADR-013 Decision 3 *"bullets are already content-embedded"*; ADR-002 table footnotes; [authoring guide](../guides/authoring-for-ai-indexing.md) *"Bullets inside a bullet group are still searched"*.)
- **Preserve the incremental / cost-control guarantee from §5** so users are not re-billed for summaries on untouched notes: content-hash-unchanged subtrees still skip summary work. (REQUIREMENTS §5 *"Cost control: Skip redundant summary work when a note's content hash is unchanged"*; ADR-013 Decision 5 *"Staleness / skip logic … is unchanged"*.)
- **Automatically upgrade existing prose summaries on the user's behalf** when the rubric prompt version changes, so users benefit from the new rubric without manually triggering anything. (ADR-013 Decision 6 *"A full reindex regenerates structured summaries"*; WKF-4 Y6 version-based invalidation; STO-4 Y6 backfill to `'legacy'`.)

## 2. Non-goals

- **Not specifying the exact model output format of the rubric** (YAML vs. Markdown list vs. labeled sections). The format is versioned via `SUMMARY_RUBRIC_VERSION` and may evolve. (ADR-013 *Explicit non-decisions*.)
- **Not introducing structured storage or per-field retrieval of rubric data.** The rubric block is embedded verbatim into the existing single-string `summaries.summary_text` column; "search entities only" style APIs are out of scope. (ADR-013 *Explicit non-decisions*; WKF-4 Y4.)
- **Not changing chat context assembly, Phase 3 token budgets, or how summaries are surfaced in search/chat UI.** Structured summaries flow into the same "parent summary" tier as before. (ADR-013 *Explicit non-decisions*; out-of-scope per [RET-2](../features/RET-2.md).)
- **Not altering retrieval settings** (coarse-K, hybrid recall, path/date filters). Those are covered by REQ-001, ADR-012, ADR-014, and their own stories. (REQUIREMENTS §5; ADR-013 Links.)
- **Not specifying a user-facing "structured summaries on/off" setting.** The rubric is the product's summarization behavior, not a toggle. (ADR-013 Decision 1, Decision 3 — no toggle referenced.)
- **Not defining UI for showing regeneration progress to the user** as part of this REQ. Whether and how rubric-driven regeneration surfaces in the existing progress slideout is an open question (§7).

## 3. Personas / actors

- **Vault owner with a heterogeneous daily-notes vault** — the Obsidian user whose daily notes mix work, journal, job-search, and errands in short sections. They ask entity- and date-specific questions ("what did I discuss with Acme last week?") and previously saw the model miss answers that plainly existed in the vault because prose summaries flattened breadth. (ADR-013 Context shape #1; [authoring guide](../guides/authoring-for-ai-indexing.md) *"Daily notes and dated filenames"*.)
- **Vault owner with topic-dump or MOC-style notes** — same user, acting on long reference notes whose value is an enumeration of many entities, dates, decisions, or links. They need coarse retrieval to match any of several listed items, not just whichever one a prose summary happened to mention. (ADR-013 Context shapes #2 and #3.)
- **Existing-vault user upgrading across a rubric version** — a user who already indexed their vault under the previous prose prompt (or a prior rubric version) and is now running a build that ships a newer `SUMMARY_RUBRIC_VERSION`. They expect their queries to start benefiting from the new rubric automatically, without a manual reindex flag. (ADR-013 Decision 6; WKF-4 Y6; STO-4 Y6.)

## 4. User scenarios (Gherkin)

### S1 — `note` summary carries the breadth-preserving rubric, not prose

```gherkin
Given the user has indexed a note whose content spans multiple themes, named entities, and dates
When  the summarization workflow produces a summary for the `note` node
Then  the summary covers the rubric fields defined by ADR-013:
      - topics discussed
      - named entities (people, organizations, projects)
      - dates and time references
      - actions and decisions
      - tags
And   the summary is a bounded structured block (not a free 2–4-sentence prose paragraph)
And   the embedded summary vector preserves breadth across those fields rather than collapsing to one theme
```

*Traces to:* REQUIREMENTS §5 *"Structured note/topic summaries (iter-2)"*; ADR-013 Decision 1, Decision 4.

*Implemented by: WKF-4*

### S2 — `topic` and `subtopic` summaries use the same rubric, scoped to the section

```gherkin
Given a note with one or more headings that produce `topic` and/or `subtopic` nodes
When  the summarization workflow produces a summary for a `topic` or `subtopic` node
Then  the summary uses the same rubric fields as S1, scoped to that section's subtree
And   the rubric output is the same shape (structured block), not prose
```

*Traces to:* REQUIREMENTS §5 *"Structured note/topic summaries (iter-2) … note and topic/subtopic summaries must be breadth-preserving"*; ADR-013 Decision 1, Decision 4 ("prompt shape per node type").

*Implemented by: WKF-4*

### S3 — Per-field caps and overall length budget are enforced; truncation is observable

```gherkin
Given a node whose content would naturally produce more rubric items than the per-field caps allow
And   the model returns output that exceeds the per-summary token budget
When  the summarization workflow persists the summary
Then  the stored summary respects the per-field item caps from ADR-013
      (e.g. capped topics, named entities, dates, actions, and tags)
And   the stored summary respects the per-summary length budget from ADR-013
And   when truncation is applied to bring the output within budget, the workflow emits a logged event recording that truncation fired
```

*Traces to:* REQUIREMENTS §5 *"Structured note/topic summaries (iter-2)"*; ADR-013 Decision 2 *"bounded length, not prose length … per-field item cap … over-budget content is truncated"*; WKF-4 Y3 and Y5 (caps and truncation-logged-at-warn behavior).

*Implemented by: WKF-4*

### S4 — Rubric output is well-formed even when a note lacks content for a rubric field

```gherkin
Given a note whose content genuinely has no actions (or no dates, or no named entities, etc.)
When  the summarization workflow produces a summary for that node
Then  the summary is still well-formed (structured block with the rubric shape)
And   fields for which the note has no content are allowed to be empty
And   the workflow does not synthesize or invent rubric items to fill empty fields
```

*Traces to:* REQUIREMENTS §5 (breadth preserved across whatever fields *do* apply); ADR-013 Decision 1 (fields enumerate what is present, not required); ADR-013 Decision 2 *"model is instructed to prefer breadth over depth"* (no fabrication implied).

*Implemented by: WKF-4*

### S5 — `bullet_group` nodes receive no summary vector

```gherkin
Given a note whose structure contains `bullet_group` nodes (consecutive bullets grouped by the chunker)
When  the summarization workflow runs over that note
Then  no summary is generated for any `bullet_group` node
And   no row in the `summaries` table is written for any `bullet_group` node
And   no summary embedding (vector) is produced for any `bullet_group` node
And   the coarse-phase summary corpus therefore contains no `bullet_group`-owned vectors
```

*Traces to:* REQUIREMENTS §5 *"Selective summary embeddings (iter-2)"*; ADR-002 *"Summary-embedding node-type policy (iter-2)"* table (`bullet_group` → summary generated: no, summary embedded: no); ADR-013 Decision 3.

*Implemented by: WKF-4, STO-4*

### S6 — Bullet content remains retrievable even though `bullet_group` is skipped

```gherkin
Given a note whose only mention of a fact lives inside a bullet under a `bullet_group`
And   the `bullet_group` has no summary vector (per S5)
When  the user searches for that fact
Then  the bullet's content is still reachable via the content-vector retrieval path under its enclosing `subtopic` (or `note`) ancestor
And   the user can still navigate to the originating note from the result
```

*Traces to:* ADR-013 Decision 3 *"bullets are already content-embedded"*; ADR-002 summary-embedding node-type policy table (leaf `bullet` → "content is embedded directly"); [authoring guide](../guides/authoring-for-ai-indexing.md) *"Bullets inside a bullet group are still searched — they just contribute content-level vectors rather than their own summary"*; REQUIREMENTS §4 *"Semantic search returns results that support opening the relevant note"*.

*Implemented by: WKF-4, STO-4*

### S7 — Every stored summary carries a prompt-version stamp

```gherkin
Given the summarization workflow has just produced a new summary for a `note`, `topic`, or `subtopic` node
When  the workflow persists the summary
Then  the stored row records the rubric prompt version that produced it
      (the current SUMMARY_RUBRIC_VERSION, not an unset or implicit value)
And   a round-trip read of the stored summary returns that same prompt-version value
```

*Traces to:* ADR-013 Decision 4 *"versioned constant (e.g. `SUMMARY_RUBRIC_V1`) … so retrieval-quality tests can pin behavior"*; WKF-4 Y6 (`summaries.prompt_version` is updated to the current rubric version on every new write); STO-4 Y6 (schema-level column for the stamp).

*Implemented by: WKF-4, STO-4*

### S8 — Summaries written under an older prompt version regenerate automatically

```gherkin
Given the user has a vault containing stored summaries whose prompt-version is older than the current SUMMARY_RUBRIC_VERSION
      (for example: pre-existing prose summaries carrying the `'legacy'` default, or summaries from a prior rubric version)
And   the user has not manually requested a reindex
When  the summarization workflow next runs over those notes (for example during ordinary indexing or a startup/resume pass)
Then  the workflow treats any summary with an older prompt-version as stale
And   it regenerates that summary under the current rubric, independent of whether the content hash changed
And   subsequent user queries benefit from the current rubric without a manual action
```

*Traces to:* ADR-013 Decision 6 *"Existing prose summaries remain usable until reindexed. A full reindex regenerates structured summaries"*; WKF-4 Y6 *"When the workflow detects a stored summary with an older version, it treats the node as dirty and regenerates — independent of the hash-based staleness rule"*; REQUIREMENTS §5 *"LLM-generated summaries … are re-generated when content changes"* (invalidation path preserved).

*Implemented by: WKF-4*

### S9 — Migration adds the prompt-version stamp to pre-existing summary rows without losing them

```gherkin
Given a DB that was created under an earlier schema where `summaries` had no prompt-version column
And   that DB already contains rows from previous indexing runs
When  the migration that introduces prompt-version tracking is applied on startup
Then  every pre-existing `summaries` row ends up with a legacy default prompt-version value
And   no pre-existing summary row is dropped or truncated by the migration
And   the subsequent summarization pass (per S8) regenerates these summaries at its own pace
```

*Traces to:* STO-4 Y6 *"`summaries.prompt_version` is `TEXT NOT NULL DEFAULT 'legacy'`; existing rows are backfilled to `'legacy'`"*; STO-4 Phase D (D1 column addition, D2 backfill); ADR-013 Decision 6.

*Implemented by: STO-4*

### S10 — Content-hash-unchanged skip still fires when the prompt version is current

```gherkin
Given a node whose content hash has not changed since its summary was written
And   that stored summary already carries the current SUMMARY_RUBRIC_VERSION
When  the summarization workflow runs over that node
Then  the workflow skips the summary call for that node (no chat provider invocation)
And   no new `summaries` row is written for that node
And   the cost-control guarantee from REQUIREMENTS §5 is preserved
```

*Traces to:* REQUIREMENTS §5 *"Cost control: Skip redundant summary work when a note's content hash is unchanged (incremental indexing)"*; ADR-013 Decision 5 *"Incremental behavior preserved … Staleness / skip logic from WKF-1 and ADR-008 is unchanged"*; WKF-4 Y6 (version invalidation is additive, not a replacement, for hash-based staleness).

*Implemented by: WKF-4*

## 5. Constraints

- **Rubric fields are fixed at five categories.** Every `note` / `topic` / `subtopic` summary must express: topics discussed, named entities, dates/time references, actions/decisions, and tags. Adding or dropping a category is a rubric-version bump, not a silent change. (ADR-013 Decision 1.)
- **Rubric output is bounded.** Per-field item caps and an overall per-summary length budget apply, with over-budget output truncated and the truncation logged. (ADR-013 Decision 2; WKF-4 Y3, Y5.)
- **`bullet_group` produces no summary and no summary vector.** The coarse-phase summary corpus contains only `note`, `topic`, and `subtopic` vectors per the amended ADR-002 node-type policy table; other leaf types (`paragraph`, `sentence_part`, `bullet`) were already leaves. (REQUIREMENTS §5; ADR-002 amendment; ADR-013 Decision 3.)
- **Leaf content is still embedded directly.** Bullets, paragraphs, and sentence parts remain retrievable via content vectors so skipping `bullet_group` summaries does not remove them from recall. (ADR-002 node-type policy table; ADR-013 Decision 3 *"bullets are already content-embedded"*.)
- **Prompt version is a first-class, persisted field.** Every summary row carries the prompt version that produced it; the stored value must round-trip faithfully so staleness logic and retrieval-quality tests can pin behavior. (ADR-013 Decision 4; WKF-4 Y6; STO-4 Y6.)
- **Version mismatch forces regeneration regardless of content hash.** Older-version summaries are treated as stale even when the node's content is unchanged; this is the auto-upgrade path for existing vaults. (ADR-013 Decision 6; WKF-4 Y6.)
- **Content-hash skip remains in force when the version matches.** When a node's content hash is unchanged *and* its summary already carries the current rubric version, no chat call and no write occur. (REQUIREMENTS §5 *"Skip redundant summary work when a note's content hash is unchanged"*; ADR-013 Decision 5.)
- **Migration is purely additive and preserves existing summaries.** The schema change that introduces prompt-version tracking must not drop or rewrite pre-existing summary rows; it backfills a legacy default and lets the regeneration path (S8) take over. (STO-4 Y6, Y7; Phase D2 backfill.)
- **Summary storage shape is unchanged.** The rubric block is embedded verbatim into the existing single-string `summaries.summary_text` column; no structured columns, no per-field APIs. (ADR-013 Decision 5, *Explicit non-decisions*; WKF-4 Y4.)
- **Chat context assembly / Phase 3 budgets are not changed by this REQ.** Structured summaries flow into the existing "parent summary" tier. (ADR-013 *Explicit non-decisions*.)

## 6. Resolved questions

These questions were raised or implied during the design of ADR-013, ADR-002 (amendment), WKF-4, and STO-4. They are captured here so downstream stories do not re-open them.

| # | Question                                                                                                       | Resolution                                                                                                                                                         | Source                                           |
|---|----------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| 1 | Should `note`/`topic`/`subtopic` summaries be 2–4-sentence prose or a structured breadth-preserving block?    | Structured rubric covering topics, entities, dates, actions, tags. Prose is explicitly rejected because it drops breadth on heterogeneous notes.                   | ADR-013 Context and Decision 1                   |
| 2 | Should every non-leaf node produce a summary vector?                                                           | No. Only `note`, `topic`, and `subtopic` produce summaries and summary vectors. `bullet_group` is skipped; other node types are leaves.                             | ADR-002 amendment table; ADR-013 Decision 3      |
| 3 | How do existing prose summaries upgrade to the rubric?                                                         | Automatically via prompt-version staleness: legacy-version rows regenerate on the next summary pass without user action. A full reindex is also an acceptable path. | ADR-013 Decision 6; WKF-4 Y6; STO-4 Y6           |
| 4 | Should the rubric prompt be baked into each provider adapter or kept provider-neutral?                         | Kept in a versioned constant (`SUMMARY_RUBRIC_VERSION`) co-located with `SummaryWorkflow`; still rides the existing `IChatPort.complete` call. Provider-neutral.   | ADR-013 Decision 4; WKF-4 §2, Y1                 |
| 5 | Is the rubric block parsed into structured columns in MVP?                                                     | No. The block is embedded verbatim into the existing single-string summary column. Structured storage / per-field retrieval is a follow-up.                        | ADR-013 *Explicit non-decisions*; WKF-4 Y4       |
| 6 | Will skipping `bullet_group` summaries hurt recall for content that only lives in bullets?                     | No. Bullets are already content-embedded leaves and remain reachable via Phase 2 content ANN under the enclosing `subtopic`/`note` ancestor.                       | ADR-013 Decision 3; ADR-002 node-type policy table |
| 7 | Does this feature change how chat context is assembled from retrieved summaries?                               | No. Chat context assembly and Phase 3 token budgets are unchanged; structured summaries flow into the same "parent summary" tier as before.                        | ADR-013 *Explicit non-decisions*                 |

## 7. Open questions

These are not resolved by the source material and block downstream design/story planning for the areas they touch.

- [ ] **Exact rubric output format** (YAML-like labeled block vs. Markdown list vs. a stricter mini-schema). ADR-013 *Explicit non-decisions* defers this to `SUMMARY_RUBRIC_VERSION`; WKF-4 Y4 assumes "compact, parseable block (YAML-like)" but explicitly does not parse it. Whether the initial shipping version pins a specific format shape is still open.
- [ ] **Reconciliation of the per-summary token budget between ADR-013 and WKF-4.** ADR-013 Decision 2 names a default of ≈180 tokens; WKF-4 Y5 names ≤256 tokens. Which value is user-visible (i.e. effectively caps stored summary length) needs product sign-off before implementation locks behavior.
- [ ] **Handling of extraction errors from the model.** If the provider returns an empty body, a truncated response, or output that is clearly not rubric-shaped, the user-visible behavior is unspecified: fall back to a prose/heading summary, drop the summary entirely (equivalent to "no summary vector for this pass"), or persist whatever was returned and rely on the content-hash/version staleness to retry later. ADR-013 and WKF-4 both stop at "workflow stores whatever text is returned."
- [ ] **User visibility of rubric regeneration progress.** When an upgrade triggers wholesale regeneration (S8) across a large vault, whether the existing progress-slideout surface reports that specifically (e.g. "regenerating summaries for new rubric version") or folds it silently into the normal indexing counter is open. ADR-013 does not specify a UI surface; REQUIREMENTS §3 guarantees non-blocking progress feedback generically.
- [ ] **Whether the per-field item caps themselves are user-tunable.** ADR-013 Decision 2 says caps are "tunable" and WKF-4 Y3 pins specific numbers as story-level defaults. Whether the settings surface exposes them or they stay as in-code constants for MVP is open.

## 8. Suggested ADR triggers

| Trigger                                                                                                                                                                                                                                                                                         | Why it already has an ADR                                                                                                                                                                                                                                                                   | Related Sn                                  |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------|
| Breadth-preserving rubric as the summarization shape for `note`/`topic`/`subtopic` nodes, prompt versioning, and per-field caps. **Already satisfied by [ADR-013](../decisions/ADR-013-structured-note-summaries.md) (Accepted, 2026-04-16)** — do not propose a new ADR. Downstream stories must cite ADR-013 in their Linked ADRs and Binding constraints. | Long-lived constraint on the prompt shape, the versioned constant lifecycle, and the upgrade path for existing vaults. Silent regression is easy if a future change reintroduces prose prompts or drops the version stamp. ADR-013 binds the rubric and the auto-regen invariant. | S1, S2, S3, S4, S7, S8, S10                 |
| Which hierarchy node types produce a summary vector. **Already satisfied by [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) (Accepted; *"Summary-embedding node-type policy (iter-2)"* amendment)** — do not propose a new ADR. Downstream stories must cite the amended table when they add, remove, or branch by node type. | Long-lived constraint on how the coarse-phase summary corpus is assembled. Any change that starts summarizing `bullet_group` (or that starts summarizing a new node type) must update this table and REQ-005 together to stay consistent. | S5, S6, S9                                  |

## 9. Links

- Source material: see header
- Related REQ files: [REQ-001 — Grounding policy](REQ-001-grounding-policy.md) (downstream consumer of coarse retrieval; not directly coupled to this feature).
- Related ADRs (already exist): [ADR-013 — Structured note summaries](../decisions/ADR-013-structured-note-summaries.md) (Accepted); [ADR-002 — Hierarchical document model](../decisions/ADR-002-hierarchical-document-model.md) (Accepted; amended for the node-type summary-vector policy). Indirectly referenced: [ADR-003 — Phased retrieval strategy](../decisions/ADR-003-phased-retrieval-strategy.md) (consumes the summary corpus), [ADR-008 — Idempotent indexing state machine](../decisions/ADR-008-idempotent-indexing-state-machine.md) (staleness/regeneration semantics).
- Related in-flight stories: [WKF-4 — Structured note/topic/subtopic summaries](../features/WKF-4.md) (behavior); [STO-4 — FTS5 index, prompt-version, and temporal metadata migration](../features/STO-4.md) (schema/migration).
- Related user guide: [`docs/guides/authoring-for-ai-indexing.md`](../guides/authoring-for-ai-indexing.md) §"Limits".

---

*Created: 2026-04-20 | Refined by: architect in Discovery Mode*
