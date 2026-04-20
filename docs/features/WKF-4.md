# WKF-4: Structured note/topic/subtopic summaries

**Story**: Replace the free-prose summary prompt in `SummaryWorkflow` with a **structured rubric** for `note`, `topic`, and `subtopic` nodes (topics, entities, dates, actions, tags); **skip** summary generation and embedding entirely for `bullet_group` nodes; version the prompt template (`SUMMARY_RUBRIC_V1`) so re-runs after prompt upgrades can invalidate prior summaries.
**Epic**: 4 — Index, summary, and embedding workflows
**Size**: Medium
**Status**: Planned

---

## 1. Summary

Coarse retrieval relies on summaries being **semantically dense and lexically diverse**. The current prose prompt produces 2–4 sentence narratives that compress away the named entities, dates, and actionable verbs that users query with. [ADR-013](../decisions/ADR-013-structured-note-summaries.md) replaces prose with a structured rubric: a compact YAML-like block listing topics, entities, dates, actions, and tags with per-field item caps. Because the output is structured, embedding the block preserves keyword breadth (names, dates) that matters for both vector similarity and hybrid FTS5 ranking ([RET-5](RET-5.md)).

Separately, `bullet_group` nodes summarize poorly (they are a grouping artifact, not a semantic unit) and contribute thousands of low-signal vectors. Skipping them reduces index size and retrieval noise without losing recall — bullets are still reachable via their parent `subtopic` or via Phase 2 content ANN.

**Prerequisites:** [WKF-1](WKF-1.md) (`SummaryWorkflow` orchestration), [ADR-013](../decisions/ADR-013-structured-note-summaries.md) **Accepted**, [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) amendment (node-type summary-vector policy).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                         | Why it binds this story                                                          |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [docs/decisions/ADR-013-structured-note-summaries.md](../decisions/ADR-013-structured-note-summaries.md)     | Rubric shape, field caps, prompt version, bullet_group skip rationale.           |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Node-type → summary-vector policy table amended in Phase B.                      |
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md)               | Prompt still rides `IChatPort.complete`; no provider-specific output parsing.    |
| [docs/decisions/ADR-008-idempotent-indexing-state-machine.md](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Prompt-version bump invalidates stored summaries for regen.                     |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs do not contradict each other
- [ ] Section 4 (Binding constraints) is filled
- [ ] Phase Y has at least one criterion with non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Prompt constant `SUMMARY_RUBRIC_V1` lives in `src/core/domain/summaryPrompts.ts` and is imported by `SummaryWorkflow`. It is a **pure string template** (no provider imports).
2. **Y2** — `SummaryWorkflow` selects a prompt per node type:
   - `note`, `topic`, `subtopic` → `SUMMARY_RUBRIC_V1`
   - `bullet_group` → **skip** (no chat call, no row in `summaries`, no embedding)
   - `paragraph`, `sentence_part`, `bullet` → already leaves; unchanged
3. **Y3** — Rubric fields and caps (documented in-prompt):
   - `topics`: up to 8 short phrases
   - `entities`: up to 12 proper nouns (people, orgs, projects, places)
   - `dates`: up to 6 ISO-formatted dates or date ranges found in content
   - `actions`: up to 8 verb-phrases extracted from first-person / actionable content
   - `tags`: up to 12, includes existing inline tags plus lightweight topic tags
4. **Y4** — Output format requested by the prompt is a compact, parseable block (YAML-like). The workflow **does not parse** it for structured storage in MVP — it stores the whole block as the `summaries.summary_text` column so it embeds verbatim. Parsing/structured storage is a follow-up story.
5. **Y5** — Token budget: prompt instructs model to stay ≤ 256 tokens; if the model exceeds significantly, workflow truncates at a safe boundary before persisting. Log at `warn` when truncation fires.
6. **Y6** — **`summaries.prompt_version`** column (or JSON sidecar field) is updated to `SUMMARY_RUBRIC_V1` on every new write. When the workflow detects a stored summary with an **older version**, it treats the node as dirty and regenerates — independent of the hash-based staleness rule from [WKF-1 §Summary](WKF-1.md).
7. **Y7** — Embedding pass (WKF-2) must skip nodes whose summary row is absent (automatically true for `bullet_group` after this story).

---

## 5. API Endpoints + Schemas

No HTTP routes.

Schema delta — extend `summaries` with a prompt version column (authored as part of [STO-4](STO-4.md) or a small follow-up migration):

```sql
ALTER TABLE summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS idx_summaries_prompt_version ON summaries(prompt_version);
```

Port additions:

```ts
// src/core/ports/IDocumentStore.ts
export interface UpsertSummaryInput {
  nodeId: string;
  summaryText: string;
  promptVersion: string; // new
  generatedAt: string;
}
```

---

## 6. Frontend Flow

Not applicable.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                     | Purpose                                                                |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `src/core/domain/summaryPrompts.ts`                      | `SUMMARY_RUBRIC_V1` constant + per-node-type prompt selector.          |
| 2   | `tests/core/domain/summaryPrompts.test.ts`               | Asserts prompt contains required rubric headers and caps.              |
| 3   | `tests/core/workflows/SummaryWorkflow.rubric.test.ts`    | Workflow chooses rubric prompt for note/topic/subtopic; skips bullet_group. |

### Files to MODIFY

| #   | Path                                                  | Change                                                                                     |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `src/core/workflows/SummaryWorkflow.ts`               | Select prompt by node type; skip `bullet_group`; pass `promptVersion` through on upsert.   |
| 2   | `src/core/ports/IDocumentStore.ts`                    | Extend `UpsertSummaryInput` with `promptVersion`.                                          |
| 3   | `src/sidecar/adapters/SqliteDocumentStore.ts`         | Persist `prompt_version`; use in staleness check.                                          |
| 4   | `src/sidecar/db/migrate.ts` (+ migration SQL)         | Add column + index.                                                                        |
| 5   | `tests/core/workflows/SummaryWorkflow.test.ts`        | Update fixtures that assumed prose prompt shape; add version-change invalidation test.     |
| 6   | `tests/sidecar/adapters/SqliteDocumentStore.summaries.test.ts` | Round-trip `prompt_version`.                                                       |

### Files UNCHANGED

- `src/core/domain/chunker.ts` — tree shape unchanged.
- `src/core/workflows/SearchWorkflow.ts` — consumes `summaries.summary_text` unchanged.

---

## 8. Acceptance Criteria Checklist

### Phase A: Prompt selection & skip

- [ ] **A1** — Given a note tree with `note`, `topic`, `subtopic`, `bullet_group`, and leaves, `SummaryWorkflow` invokes `IChatPort.complete` for `note`/`topic`/`subtopic` only; `bullet_group` generates no chat call and no `summaries` row.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A1_prompt_selection`
- [ ] **A2** — Captured prompt text for a `note` summarization contains the rubric headers: `topics:`, `entities:`, `dates:`, `actions:`, `tags:`.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A2_rubric_headers`

### Phase B: Prompt version & invalidation

- [ ] **B1** — Every upsert sends `promptVersion: 'SUMMARY_RUBRIC_V1'`; round-trip preserves the value.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.test.ts::B1`
- [ ] **B2** — A stored summary with `prompt_version = 'legacy'` is treated as stale; `SummaryWorkflow` regenerates even if hashes match.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B2_version_invalidates`

### Phase C: Truncation & budget

- [ ] **C1** — When the model returns text exceeding the documented budget, workflow truncates before persisting and logs at `warn`.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::C1_truncation`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — `summaryPrompts.ts` has no provider / sqlite / obsidian imports.
  - Evidence: `npm run check:boundaries` + static grep.
- [ ] **Y2** — **(non-mock)** SQLite migration adds `prompt_version` column; `PRAGMA table_info(summaries)` confirms.
  - Evidence: `tests/sidecar/db/migrations.test.ts::Y2_prompt_version_column`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes
- [ ] **Z2** — `npm run lint` passes
- [ ] **Z3** — No `any` types
- [ ] **Z4** — N/A
- [ ] **Z5** — Log prompt version, node type, truncation-fired flag per summary call at `debug`.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                              | Mitigation                                                                                                    |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | Rubric output is verbose; embeds more tokens per summary     | Per-field caps + 256-token budget + truncation keep size bounded; net summary-vector count drops (bullet_group skipped). |
| 2   | Existing vaults have `legacy` summaries until reindex        | Version-based invalidation auto-triggers regeneration on the next summary pass.                               |
| 3   | Model ignores rubric and returns prose                       | Prompt is strict with examples; workflow still stores whatever text is returned — it just embeds worse that pass. |

---

## Implementation Order

1. `summaryPrompts.ts` constant + tests.
2. Port / schema plumbing for `promptVersion`.
3. `SummaryWorkflow` branches by node type; invalidation on version change.
4. Migration + store adapter update.
5. Test updates + fixtures.
6. Full verify.

---

_Created: 2026-04-16 | Story: WKF-4 | Epic: 4 — Index, summary, and embedding workflows_
