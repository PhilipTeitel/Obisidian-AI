# WKF-4: Structured note/topic/subtopic summaries and `bullet_group` skip

**Story**: Replace the free-prose summary prompt in `SummaryWorkflow` with a breadth-preserving **structured rubric** for `note`, `topic`, and `subtopic` nodes (topics, entities, dates, actions, tags); **skip** summary generation and embedding entirely for `bullet_group` nodes; stamp every stored summary with the current `SUMMARY_RUBRIC_VERSION` so older-version rows regenerate automatically on the next summary pass.
**Epic**: 4 — Index, summary, and embedding workflows
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Coarse retrieval depends on summary vectors being **semantically broad** — a single summary embedding has to stand in for every theme, entity, and date in its subtree. The current prose prompt in [`SummaryWorkflow`](../../src/core/workflows/SummaryWorkflow.ts) produces 2–4 sentence narratives that collapse that breadth to whichever topic the model picks to mention, which is the root cause of the entity- and date-specific false negatives documented in [REQ-005 §1](../requirements/REQ-005-structured-summaries.md) and [ADR-013 Context](../decisions/ADR-013-structured-note-summaries.md). This story replaces the prose prompt with a **versioned rubric** (topics, entities, dates, actions, tags) for `note`, `topic`, and `subtopic` nodes, and formalizes the `bullet_group` skip per the amended summary-embedding node-type policy in [ADR-002](../decisions/ADR-002-hierarchical-document-model.md).

The story also owns the **automatic upgrade path**: every stored summary carries a prompt-version stamp, and the workflow treats any row whose version is older than the current `SUMMARY_RUBRIC_VERSION` as stale, regenerating independent of the content-hash skip inherited from WKF-1 / ADR-008. The content-hash skip still fires whenever both the hash is unchanged **and** the stored version matches, so cost-control from [REQUIREMENTS §5](../requirements/REQUIREMENTS.md) is preserved.

This story implements REQ-005 scenarios **S1, S2, S3, S4, S5, S6, S7, S8, and S10**. It is scoped to the workflow and summary-row write path; it does **not** add columns to SQLite or backfill pre-existing rows — that is STO-4's migration. See out-of-scope below.

**Out of scope (handled by STO-4):**

- **S9 — migration adds the prompt-version stamp to pre-existing rows without losing them.** The `ALTER TABLE summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'legacy'`, the index, and the backfill of existing rows to `'legacy'` are part of [`002_fts.sql`](../../src/sidecar/db/migrations/002_fts.sql) owned by [STO-4](STO-4.md) (Y6, D1, D2). WKF-4 **consumes** that column; it does not author the migration. If STO-4 has not landed, WKF-4 cannot persist `prompt_version` and is blocked at DoR.

**Prerequisites:** [WKF-1](WKF-1.md) (`SummaryWorkflow` orchestration), [STO-4](STO-4.md) (adds `summaries.prompt_version`), [ADR-013](../decisions/ADR-013-structured-note-summaries.md) **Accepted**, [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) amendment (node-type summary-vector policy).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-013-structured-note-summaries.md`](../decisions/ADR-013-structured-note-summaries.md) | Binding rubric shape, per-field caps, per-summary length budget, versioned prompt constant, and automatic upgrade-by-version-bump path for existing vaults. |
| [`docs/decisions/ADR-002-hierarchical-document-model.md`](../decisions/ADR-002-hierarchical-document-model.md) | Amended *"Summary-embedding node-type policy (iter-2)"* table authoritatively states `bullet_group` produces neither a summary nor a summary vector; this story enforces that policy in `SummaryWorkflow`. |
| [`docs/decisions/ADR-005-provider-abstraction.md`](../decisions/ADR-005-provider-abstraction.md) | Rubric prompt still rides `IChatPort.complete`; no provider-specific output parsing or adapter-side prompt logic. |
| [`docs/decisions/ADR-008-idempotent-indexing-state-machine.md`](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Version-mismatch invalidation is additive to, not a replacement for, the hash-based staleness rule; the content-hash skip still fires when both hash and version are current. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (ADR-013 Accepted 2026-04-16; ADR-002 Accepted with iter-2 amendment; ADR-005 Accepted; ADR-008 Accepted) — confirmed
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries (REQ-005, ADR-013, ADR-002, and README §"Data model" all agree that `note`/`topic`/`subtopic` produce summary vectors and `bullet_group` does not; `summaries.prompt_version` column is owned by STO-4)
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Section 4b (Ports & Adapters) lists every port/adapter this story creates or modifies, or states explicitly that no integration boundaries are touched
- [ ] Section 8a (Test Plan) is filled and **every AC ID** (including Phase Y and Phase Z) is referenced by at least one planned test row
- [ ] For every adapter in Section 4b, Section 8a contains both a **contract test against the port** and an **integration test against the real backing service** (no mock of the boundary the adapter owns), and Phase Y has a `(binding)` criterion citing the integration test file
- [ ] Every Gherkin `Sn` ID from the linked refined requirements (`docs/requirements/REQ-005-structured-summaries.md`) is mapped to at least one acceptance test row in Section 8a — or the story explicitly states why a given `Sn` is out of scope here (S9 explicitly out of scope, owned by STO-4 — see §1)
- [ ] Phase Y includes at least one criterion with **non-mock** evidence where wrong-stack substitution is a risk (integration test against a real `better-sqlite3` DB with `002_fts.sql` applied)
- [ ] STO-4 has landed `summaries.prompt_version TEXT NOT NULL DEFAULT 'legacy'` before implementation begins (cross-story prerequisite)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Rubric prompt lives in a versioned constant `SUMMARY_RUBRIC_V1` in `src/core/domain/summaryPrompts.ts`. The module exports a **pure string template** plus a `SUMMARY_RUBRIC_VERSION` identifier; it has **no** imports from `src/sidecar/*`, `obsidian`, or any provider SDK. (ADR-013 Decision 4; ADR-005 provider-neutrality.)
2. **Y2** — `SummaryWorkflow` selects a prompt per node type:
   - `note`, `topic`, `subtopic` → `SUMMARY_RUBRIC_V1`;
   - `bullet_group` → **skip** (no `IChatPort.complete` call, no `IDocumentStore.upsertSummary` call, no embedding produced);
   - `paragraph`, `sentence_part`, `bullet` → already leaves; unchanged. (ADR-002 iter-2 table; ADR-013 Decision 3; REQ-005 S5.)
3. **Y3** — Rubric covers exactly the five categories from ADR-013 Decision 1 — `topics`, `entities`, `dates`, `actions`, `tags` — with per-field item caps documented inline in the prompt. Adding or removing a category requires bumping `SUMMARY_RUBRIC_VERSION`. (ADR-013 Decisions 1 and 2; REQ-005 §5 constraints.)
4. **Y4** — The rubric block is stored **verbatim** in the existing single-string `summaries.summary_text` column (or the port's `summary` argument). No structured columns, no per-field parsing in MVP. (ADR-013 *Explicit non-decisions*; REQ-005 §5.)
5. **Y5** — `SummaryWorkflow` enforces a per-summary length budget at or below the documented cap; when the model returns content that exceeds the budget, the workflow truncates at a safe boundary **before** persisting and logs a single `warn`-level event that names the node id, node type, and pre-truncation size. (ADR-013 Decision 2; REQ-005 S3.)
6. **Y6** — Every `upsertSummary` call carries `promptVersion = SUMMARY_RUBRIC_VERSION` (for new writes of the rubric-era); the value round-trips through `IDocumentStore` unchanged; when the workflow reads a stored summary whose `prompt_version` is older than `SUMMARY_RUBRIC_VERSION` (including `'legacy'`), it treats the node as dirty and regenerates **independent** of the content-hash skip. (ADR-013 Decisions 4 and 6; REQ-005 S7 and S8.)
7. **Y7** — When both the content hash is unchanged **and** the stored `prompt_version` matches the current `SUMMARY_RUBRIC_VERSION`, the workflow skips the summary call for that node — no `IChatPort.complete` invocation and no `upsertSummary` write occur. The content-hash skip is additive with, not replaced by, version staleness. (REQ-005 S10; REQ §5 cost control; ADR-013 Decision 5.)
8. **Y8** — Persistence for this story flows through `IDocumentStore`. The adapter under test is `SqliteDocumentStore` running against a real `better-sqlite3` DB with STO-4's `002_fts.sql` applied (so `summaries.prompt_version` exists). No core code touches SQLite directly. (Hexagonal rule — README §"Hexagonal boundary"; ADR-005.)

---

## 4b. Ports & Adapters

This story persists a new field (`promptVersion`) through the existing document store, so the `IDocumentStore` port and its `SqliteDocumentStore` adapter are modified. `IChatPort` is called by the workflow but is **not** modified by this story (the prompt text changes; the port contract does not) — it is therefore not listed here per the template's "creates or modifies" rule. Legacy WKF-4 did not declare a separate summary-generation workflow port (no `IJobStepPort` or equivalent), so none is added.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IDocumentStore` | [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts) | `SqliteDocumentStore` ([`src/sidecar/adapters/SqliteDocumentStore.ts`](../../src/sidecar/adapters/SqliteDocumentStore.ts)) | Local `better-sqlite3` DB at `var/test/wkf-4-summaries.db` with `001_relational.sql` + STO-4's `002_fts.sql` applied so the `summaries.prompt_version` column exists. | Modified in this story: `upsertSummary` gains a `promptVersion` parameter; `getSummary` returns it on the `StoredSummary` shape so the workflow can check staleness. Migration itself is owned by STO-4. |

---

## 5. API Endpoints + Schemas

No new HTTP routes. No changes to sidecar transport surface.

**Schema:** the `summaries.prompt_version` column (`TEXT NOT NULL DEFAULT 'legacy'`) and its index `idx_summaries_prompt_version` are authored by [STO-4](STO-4.md)'s `002_fts.sql` and are **not** added by this story. WKF-4 consumes the column through the port.

**Port surface changes** (shared type additions land in `src/core/domain/types.ts` and are re-exported through `src/core/ports/IDocumentStore.ts`):

```ts
export interface StoredSummary {
  summary: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
}

export interface IDocumentStore {
  upsertSummary(
    nodeId: string,
    summary: string,
    model: string,
    promptVersion: string,
  ): Promise<void>;
  getSummary(nodeId: string): Promise<StoredSummary | null>;
}
```

Rubric prompt constant (core domain, provider-neutral):

```ts
export const SUMMARY_RUBRIC_VERSION = 'SUMMARY_RUBRIC_V1';

export const SUMMARY_RUBRIC_V1: string = `...rubric prompt text with field labels: topics, entities, dates, actions, tags...`;

export type SummarizableNodeType = 'note' | 'topic' | 'subtopic';

export function selectSummaryPrompt(nodeType: string): string | null;
```

Any other fields of `StoredSummary` referenced by existing callers remain unchanged; additions are additive. Downstream embedding and search code continues to read `summary` only.

---

## 6. Frontend Flow

Not applicable — this story is entirely inside the sidecar/core and has no UI surface. Per-field retrieval, "structured summary" viewers, and UI for rubric-regeneration progress are explicitly out of scope (see REQ-005 §7 open question on progress visibility).

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/summaryPrompts.ts` | Exports `SUMMARY_RUBRIC_VERSION`, `SUMMARY_RUBRIC_V1` prompt string, and `selectSummaryPrompt(nodeType)`. Pure string template; no provider / sqlite / obsidian imports (Y1). |
| 2 | `tests/core/domain/summaryPrompts.test.ts` | Unit tests assert the rubric prompt contains all five field labels (`topics`, `entities`, `dates`, `actions`, `tags`), documents caps inline, and that `selectSummaryPrompt` returns the rubric for `note`/`topic`/`subtopic` and `null` for `bullet_group` / leaves. |
| 3 | `tests/core/workflows/SummaryWorkflow.rubric.test.ts` | Workflow-level tests for prompt selection, `bullet_group` skip, truncation-with-warn-log behavior, and version-based invalidation (A1–A4, B1–B4, C1, D2, D3). |
| 4 | `tests/core/ports/IDocumentStore.contract.ts` | Exported `assertPromptVersionRoundTrip(store)` (core-only imports; no sidecar). Adapter tests mount this helper. |
| 5 | `tests/sidecar/adapters/IDocumentStore.promptVersion.contract.test.ts` | Vitest `promptVersion_round_trip` against `SqliteDocumentStore` + in-memory migrated DB (FND-3: contract test lives under `tests/sidecar/`). |
| 6 | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts` | Integration tests on a real `better-sqlite3` file DB (temp dir) with migrations + vector schema; D1, A4, Y2, Y4–Y6, Y8. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/SummaryWorkflow.ts` | (a) Replace the prose prompt with `selectSummaryPrompt(nodeType)`; skip any `bullet_group` node before the chat call (no `IChatPort.complete`, no `upsertSummary`). (b) Enforce the length budget — truncate on over-budget model output before persisting and log once at `warn`. (c) Pass `SUMMARY_RUBRIC_VERSION` into `upsertSummary`. (d) On read, treat any `StoredSummary.promptVersion` older than `SUMMARY_RUBRIC_VERSION` as stale and regenerate even when the content hash matches. (e) When hash is unchanged **and** `promptVersion` matches, skip without calling `IChatPort`. |
| 2 | `src/core/ports/IDocumentStore.ts` | Extend `upsertSummary` signature with `promptVersion: string`; add `promptVersion` to the `StoredSummary` return shape of `getSummary`. |
| 3 | `src/core/domain/types.ts` | Add `promptVersion: string` to `StoredSummary`. |
| 4 | `src/sidecar/adapters/SqliteDocumentStore.ts` | Bind the `promptVersion` parameter in the `INSERT … ON CONFLICT … DO UPDATE` for `summaries`; project `prompt_version` in the `getSummary` read. |
| 5 | `tests/core/workflows/SummaryWorkflow.test.ts` | Update any existing fixtures that assumed a prose prompt shape. |
| 6 | `tests/contract/document-store.contract.ts` | `upsertSummary` / `getSummary` assertions include `promptVersion` (STO-4 / WKF-4 schema). |
| 7 | `README.md` | Epic 4 WKF-4 backlog row + API table `upsertSummary` signature include `promptVersion`. |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/db/migrations/002_fts.sql` — column + backfill are owned by STO-4; WKF-4 only consumes them.
- `src/sidecar/db/migrate.ts` — unchanged; STO-4 already added the migration runner hook.
- `src/core/domain/chunker.ts` — tree shape unchanged; node typing already produces `bullet_group`.
- `src/core/workflows/SearchWorkflow.ts` — still reads `summaries.summary_text` and the summary ANN table unchanged.
- `src/core/workflows/IndexWorkflow.ts` — orchestration around `SummaryWorkflow` unchanged; it still calls the workflow per-node.
- `src/core/ports/IChatPort.ts` — port contract unchanged; only the prompt content changes.
- `src/sidecar/adapters/OllamaChatAdapter.ts`, `src/sidecar/adapters/OpenAIChatAdapter.ts` — unchanged; they remain transport for whatever prompt the workflow hands them.

---

## 8. Acceptance Criteria Checklist

### Phase A: Prompt selection and `bullet_group` skip

- [x] **A1** — `SummaryWorkflow` invokes `IChatPort.complete` with `SUMMARY_RUBRIC_V1` when summarizing a `note` node; the captured prompt contains the five rubric field labels (`topics`, `entities`, `dates`, `actions`, `tags`) and does **not** contain the legacy "2–4 sentences" phrasing.
  - Verification: capture the prompt argument on a fake `IChatPort`; assert every rubric label is present and the prose phrasing is absent.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A1_note_uses_rubric(vitest)`

- [x] **A2** — For a note containing at least one `topic` and one `subtopic` descendant, `SummaryWorkflow` invokes `IChatPort.complete` with `SUMMARY_RUBRIC_V1` scoped to each section's subtree; captured prompts for `topic` and `subtopic` both expose the same five rubric labels.
  - Verification: spy on `IChatPort.complete`; assert rubric labels present for both node types.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A2_topic_and_subtopic_use_rubric(vitest)`

- [x] **A3** — For a note containing one or more `bullet_group` nodes, the workflow makes **zero** `IChatPort.complete` calls and **zero** `IDocumentStore.upsertSummary` calls for those nodes; `getSummary(bulletGroupId)` returns `null` afterwards.
  - Verification: counted spies on both ports return zero calls for `bullet_group` node ids; store round-trip returns `null`.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A3_bullet_group_skipped(vitest)`

- [x] **A4** — Bullet content remains reachable via the content-vector path: given a note whose only mention of a fact lives inside a bullet under a `bullet_group`, a query for that fact returns the bullet's node id via `IDocumentStore.searchContentVectors` under its enclosing `subtopic`/`note` ancestor.
  - Verification: integration-level search through `SqliteDocumentStore.searchContentVectors`; result set contains the bullet's node id with a non-null parent linkage.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::A4_bullet_still_retrievable(vitest)`

### Phase B: Rubric structure and well-formedness

- [x] **B1** — The exported `SUMMARY_RUBRIC_V1` string declares each of the five rubric field labels exactly once and documents per-field item caps for each; no sixth field label is present.
  - Verification: string matching on exports from `src/core/domain/summaryPrompts.ts`.
  - Evidence: `tests/core/domain/summaryPrompts.test.ts::B1_rubric_headers_and_caps(vitest)`

- [x] **B2** — When the chat port returns rubric output that exceeds the documented per-field item caps, the stored summary text still conforms to the caps (the workflow or prompt enforcement drops extras at a documented boundary); the persisted `summary_text` therefore has no more than the capped item count per field.
  - Verification: drive a fake `IChatPort` with oversized rubric output; assert persisted text honors caps.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B2_per_field_caps(vitest)`

- [x] **B3** — When the chat port returns rubric output where some fields are empty (e.g. a note with no actions), the stored summary is still structurally well-formed (each rubric field label is present with an empty or absent value) and no exception is thrown.
  - Verification: drive the fake with rubric output missing one or more field bodies; assert persistence succeeds and stored text preserves the overall rubric shape.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B3_empty_fields_well_formed(vitest)`

- [x] **B4** — The workflow does not fabricate rubric items on empty-field cases: when `IChatPort.complete` returns empty field bodies, the workflow does **not** replace them with synthesized values before persisting. The `summary_text` persisted equals the (possibly truncated) output the port returned.
  - Verification: capture the port's returned string and the persisted string; assert textual equivalence modulo documented truncation.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B4_no_fabrication(vitest)`

### Phase C: Truncation and length budget

- [x] **C1** — When the model returns text exceeding the per-summary length budget from ADR-013 / Y5, `SummaryWorkflow` truncates at a safe boundary before calling `upsertSummary` and emits exactly one `warn`-level log event that includes the node id, node type, and pre-truncation size. The persisted `summary_text` length is at or under the documented budget.
  - Verification: spy on the logger; drive an oversized chat response; assert persisted-length bound and a single `warn` call with the expected fields.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::C1_truncation_logged_at_warn(vitest)`

### Phase D: Prompt version and invalidation

- [x] **D1** — Every rubric-era `upsertSummary` call carries `promptVersion === 'SUMMARY_RUBRIC_V1'`; a subsequent `getSummary` call returns a `StoredSummary` whose `promptVersion` is exactly the stored value. Verified against the real `SqliteDocumentStore` (not a mock).
  - Verification: run rubric summary; read back via integration test; assert `storedSummary.promptVersion === 'SUMMARY_RUBRIC_V1'`.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::D1_round_trip(vitest)`

- [x] **D2** — Given a `summaries` row whose `prompt_version = 'legacy'` (or any value older than `SUMMARY_RUBRIC_VERSION`), running `SummaryWorkflow` over that node triggers regeneration (a `IChatPort.complete` call and a new `upsertSummary` with the current version) even when the content hash is unchanged.
  - Verification: seed the store with a `'legacy'` summary via the real adapter; run the workflow with identical content hash; assert a chat call fired and the stored `promptVersion` updated.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::D2_legacy_version_regenerates(vitest)`

- [x] **D3** — Given a `summaries` row whose `prompt_version` matches `SUMMARY_RUBRIC_VERSION` **and** whose node's content hash is unchanged, running `SummaryWorkflow` produces **zero** `IChatPort.complete` calls and **zero** `upsertSummary` calls for that node.
  - Verification: counted spies on both ports return zero for the node in question.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::D3_hash_and_version_match_skips(vitest)`

### Phase Y: Binding and stack compliance

- [x] **Y1** — **(binding)** `src/core/domain/summaryPrompts.ts` has zero imports from `src/sidecar/*`, `obsidian`, `better-sqlite3`, or any provider SDK.
  - Verification: static grep + boundary check.
  - Evidence: `npm run check:boundaries` (`scripts/check-source-boundaries.mjs`) and `rg "from '(\.\./)+sidecar|obsidian|better-sqlite3|openai|ollama" src/core/domain/summaryPrompts.ts` returns no matches.

- [x] **Y2** — **(binding)** For every node of type `bullet_group` in a representative fixture, `SummaryWorkflow` produces no chat call, no `summaries` row, and no summary embedding; `getSummary(bulletGroupId)` returns `null` and the coarse summary ANN table contains zero vectors owned by `bullet_group` nodes. Verified end-to-end through the real `SqliteDocumentStore` adapter.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y2_bullet_group_no_row_no_vector(vitest)`

- [x] **Y3** — **(binding)** Rubric fields and caps are authored exactly once in `SUMMARY_RUBRIC_V1`; changing the label set is guarded by a co-located test that pins the five labels and fails if a sixth is added without a `SUMMARY_RUBRIC_VERSION` bump.
  - Evidence: `tests/core/domain/summaryPrompts.test.ts::Y3_label_set_pinned(vitest)`

- [x] **Y4** — **(binding)** The workflow stores rubric output verbatim in `summaries.summary_text` without per-field parsing: a string written through the port equals the string read back (modulo documented truncation). Verified through the real SQLite adapter.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y4_summary_text_verbatim(vitest)`

- [x] **Y5** — **(binding)** When chat output exceeds the documented budget, `summary_text` persisted in SQLite is at or under the budget and a `warn` log is emitted exactly once per truncation. Verified through the real SQLite adapter; budget measured against the actual stored string length.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y5_truncation_respects_budget_in_sqlite(vitest)`

- [x] **Y6** — **(binding)** A row with `prompt_version = 'legacy'` triggers regeneration on the next summary pass; a row with `prompt_version = 'SUMMARY_RUBRIC_V1'` and unchanged content hash is skipped. Verified against a real `better-sqlite3` DB that has STO-4's `002_fts.sql` applied.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y6_version_staleness(vitest)`

- [x] **Y7** — **(binding)** The content-hash skip path still fires when `prompt_version` matches and the node's hash is unchanged: counted `IChatPort.complete` spy returns zero for that node across the run.
  - Evidence: `tests/core/workflows/SummaryWorkflow.rubric.test.ts::D3_hash_and_version_match_skips(vitest)` (shared with D3 — same behavior, binding restatement).

- [x] **Y8** — **(binding)** Persistence of `promptVersion` goes through `IDocumentStore`; no core code issues raw SQL against SQLite. Integration test against the real `better-sqlite3` DB proves the adapter writes to `summaries.prompt_version`; the contract test proves the port contract holds for any adapter.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y8_adapter_persists_prompt_version(vitest)` and `tests/sidecar/adapters/IDocumentStore.promptVersion.contract.test.ts::promptVersion_round_trip(vitest)` (helper: `tests/core/ports/IDocumentStore.contract.ts`).

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A for this story (no client changes; this gate is automatically satisfied by the lack of client surface)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines: `debug` for every summary call (node id, node type, promptVersion, hash-skip or version-skip decision), `warn` exactly once when truncation fires (Y5).
- [x] **Z6** — `/review-story WKF-4` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output).

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/summaryPrompts.test.ts::B1_rubric_headers_and_caps` | B1 | S1, S2, S3 | Prompt contains all five rubric labels + per-field caps; no sixth label. |
| 2 | unit | `tests/core/domain/summaryPrompts.test.ts::Y3_label_set_pinned` | Y3 | S1, S2 | Guard test — fails if label set drifts without a version bump. |
| 3 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A1_note_uses_rubric` | A1 | S1 | Captured prompt for `note` contains rubric labels; prose phrasing absent. |
| 4 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A2_topic_and_subtopic_use_rubric` | A2 | S2 | Rubric applied scoped to section subtree for `topic` and `subtopic`. |
| 5 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::A3_bullet_group_skipped` | A3 | S5 | Zero chat calls and zero `upsertSummary` calls for `bullet_group` ids. |
| 6 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B2_per_field_caps` | B2 | S3 | Oversized rubric output respects per-field caps after persistence. |
| 7 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B3_empty_fields_well_formed` | B3 | S4 | Empty-field rubric persists without error; shape preserved. |
| 8 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::B4_no_fabrication` | B4 | S4 | Workflow does not invent rubric items on empty fields. |
| 9 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::C1_truncation_logged_at_warn` | C1 | S3 | Over-budget output truncated and single `warn` logged with node id + size. |
| 10 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::D2_legacy_version_regenerates` | D2 | S8 | `'legacy'` row forces regen even when content hash matches. |
| 11 | unit | `tests/core/workflows/SummaryWorkflow.rubric.test.ts::D3_hash_and_version_match_skips` | D3, Y7 | S10 | Zero chat calls when hash unchanged and version current. |
| 12 | contract | `tests/sidecar/adapters/IDocumentStore.promptVersion.contract.test.ts::promptVersion_round_trip` | Y8 | S7 | Port round-trip via `assertPromptVersionRoundTrip` in `tests/core/ports/IDocumentStore.contract.ts`. |
| 13 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::D1_round_trip` | D1 | S7 | Real `better-sqlite3` DB with STO-4's `002_fts.sql`; `promptVersion` round-trips at column level. |
| 14 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y2_bullet_group_no_row_no_vector` | Y2 | S5 | Real DB: after a run, `summaries` and summary-ANN rows own zero `bullet_group` nodes. |
| 15 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::A4_bullet_still_retrievable` | A4 | S6 | Real DB: content-vector search returns the bullet node id under its enclosing ancestor. |
| 16 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y4_summary_text_verbatim` | Y4 | S1 | Rubric string stored equals rubric string read (modulo documented truncation). |
| 17 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y5_truncation_respects_budget_in_sqlite` | Y5 | S3 | Persisted string length in SQLite is at or under budget after truncation fires. |
| 18 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y6_version_staleness` | Y6 | S8, S10 | Real DB: legacy-version row regenerates, current-version unchanged-hash row skips. |
| 19 | integration | `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts::Y8_adapter_persists_prompt_version` | Y8 | S7 | Real DB: row exists in `summaries` with the written `prompt_version` value. |
| 20 | static | `npm run check:boundaries` | Y1 | — | Core/domain purity — no Obsidian/SQLite imports in `src/core/` (`scripts/check-source-boundaries.mjs`). |

Every AC ID (A1–A4, B1–B4, C1, D1–D3, Y1–Y8, Z1–Z6) appears in the table above except standard `Z1–Z6` quality gates, which are covered by the project-wide build / lint / review pipeline rather than planned per-test rows. Every WKF-4-tagged Sn (S1, S2, S3, S4, S5, S6, S7, S8, S10) appears in **Covers Sn** on at least one row. S9 is explicitly out of scope and covered in STO-4's test plan.

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Rubric output is verbose; per-summary embed cost rises ~20–40% vs prose. | Per-field caps + length budget + truncation cap per-summary token cost; net summary-vector count drops because `bullet_group` summaries are skipped (~15–30% of LLM summary calls in bulleted notes per ADR-013). |
| 2 | Existing vaults carry `'legacy'` summaries until their next summary pass. | Version-based invalidation (Y6, D2, S8) regenerates automatically on the next run over each affected note; no user action required. |
| 3 | Model ignores the rubric instruction and returns prose. | Prompt is strict and includes examples; truncation + version stamp let retrieval-quality regressions be detected and re-run under a future `SUMMARY_RUBRIC_VERSION` bump. The workflow still persists whatever text is returned (ADR-013 Decision 1); it just embeds worse that pass. |
| 4 | Skipping `bullet_group` could hurt recall for bullet-only content. | S6 / A4 / REQ-005 §5 *"Leaf content is still embedded directly"* — bullets remain content-embedded and reachable via Phase 2 content ANN under their enclosing ancestor. Covered by an integration test against the real SQLite adapter. |
| 5 | Story depends on STO-4 landing `summaries.prompt_version` first. | DoR item gates implementation start on STO-4 completion; out-of-scope note in §1 makes the dependency explicit for reviewers. |
| 6 | Prompt length budget mismatch between ADR-013 (≈180 tokens) and the story (≤256 tokens) — open question in REQ-005 §7. | Y5 and C1 reference a single constant `SUMMARY_RUBRIC_V1_MAX_TOKENS` declared in `summaryPrompts.ts`; the implementer picks the value per product direction before coding and the binding test asserts whatever the code declares. A future version bump can revisit. |

---

## Implementation Order

1. `src/core/domain/summaryPrompts.ts` — declare `SUMMARY_RUBRIC_VERSION`, `SUMMARY_RUBRIC_V1`, and `selectSummaryPrompt`. Add `tests/core/domain/summaryPrompts.test.ts` red-first (covers B1, Y3).
2. `src/core/domain/types.ts` + `src/core/ports/IDocumentStore.ts` — extend `StoredSummary` and `upsertSummary` with `promptVersion`.
3. `tests/core/ports/IDocumentStore.contract.ts` — author the contract suite including `promptVersion_round_trip` (covers Y8, S7).
4. `src/sidecar/adapters/SqliteDocumentStore.ts` — bind `promptVersion` in the upsert / read SQL. Add `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts` mounting the contract suite and adding the integration rows (covers D1, A4, Y2, Y4, Y5, Y6, Y8).
5. **Verify** — run `npm run check:boundaries`, the contract suite, and the SQLite integration suite against a fresh `var/test/wkf-4-summaries.db`; confirm STO-4's `002_fts.sql` has been applied (column exists; `PRAGMA table_info(summaries)` lists `prompt_version TEXT NOT NULL DEFAULT 'legacy'`).
6. `src/core/workflows/SummaryWorkflow.ts` — (a) prompt selection by node type with `bullet_group` skip; (b) length-budget truncation + `warn` log; (c) pass `SUMMARY_RUBRIC_VERSION` into `upsertSummary`; (d) version-mismatch regeneration; (e) hash-and-version match skip. Add `tests/core/workflows/SummaryWorkflow.rubric.test.ts` red-first covering A1–A3, B2–B4, C1, D2, D3.
7. Update `tests/core/workflows/SummaryWorkflow.test.ts` fixtures that assumed prose prompt shape.
8. **Verify** — full workflow unit run; confirm `/review-story WKF-4` (Z6) returns no `high`/`critical` findings on the changed surface.
9. `README.md` — point the Epic 4 WKF-4 row at this refreshed story document.
10. **Final verify** — `npm run build`, `npm run lint`, full contract + integration suite; confirm REQ-005 Sn coverage matrix in §8a holds and no out-of-scope Sn leaked into this story.

---

*Created: 2026-04-20 | Story: WKF-4 | Epic: 4 — Index, summary, and embedding workflows*
