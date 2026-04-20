# STO-4: FTS5 index, `note_date`, and `prompt_version` schema migration (002)

**Story**: Ship the additive SQLite migration **`002_fts.sql`** that (a) creates an external-content **FTS5 virtual table** `nodes_fts` over `nodes.content` with sync triggers, (b) adds `note_meta.note_date TEXT NULL` + index, and (c) adds `summaries.prompt_version TEXT NOT NULL DEFAULT 'legacy'` + index; extend `migrate.ts` to apply it idempotently and to rebuild the FTS index when it is empty but `nodes` is not; make `SqliteDocumentStore` run against the migrated schema so downstream stories ([RET-5](RET-5.md), [RET-6](RET-6.md), [WKF-4](WKF-4.md)) can build on a real FTS5 / `note_date` / `prompt_version` surface.
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Medium
**Status**: Complete

---

## 1. Summary

STO-4 is an **infrastructure-only** story. It owns the one-shot, additive schema migration that three downstream behavior stories sit on top of. It does not implement hybrid retrieval, temporal filtering, or structured-summary generation itself — those live in [RET-5](RET-5.md), [RET-6](RET-6.md), and [WKF-4](WKF-4.md) respectively. STO-4's job is to make sure that when those stories are implemented, the per-vault SQLite database already carries the FTS5 index, the `note_date` column, and the `prompt_version` column they need, with idempotent application, safe rebuild, and no risk of data loss.

The three schema deltas are grouped into a single migration on purpose:

1. **FTS5 over `nodes.content`** — the keyword backend required by [REQ-004 §"Constraints"](../requirements/REQ-004-hybrid-and-filters.md) and bound by [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) §3. Wired as an external-content virtual table (`content='nodes', content_rowid='rowid'`) with `AFTER INSERT/DELETE/UPDATE` triggers so writes through `SqliteDocumentStore.upsertNodes` stay mirrored without app-level double-writes.
2. **`note_meta.note_date TEXT NULL`** — the temporal metadata column required by [REQ-004 §"Constraints"](../requirements/REQ-004-hybrid-and-filters.md) and bound by [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) §4. The population rule (driven by `dailyNotePathGlobs` + `dailyNoteDatePattern` at index time) belongs to [RET-6](RET-6.md); STO-4 provides the column, the index on `(note_date)`, and the NULL-semantic for already-indexed rows.
3. **`summaries.prompt_version TEXT NOT NULL DEFAULT 'legacy'`** — the version stamp required by [REQ-005 §"Constraints"](../requirements/REQ-005-structured-summaries.md) and bound by [ADR-013](../decisions/ADR-013-structured-note-summaries.md) §4–§6. The regeneration logic (treat older versions as stale, regenerate under the current `SUMMARY_RUBRIC_VERSION`) belongs to [WKF-4](WKF-4.md); STO-4 provides the column, backfills existing rows to `'legacy'` so the upgrade path is observable, and adds the `(prompt_version)` index.

Because every behavior story depends on a real `better-sqlite3` build with FTS5 and sqlite-vec co-resident, STO-4's binding evidence is not a mock. The Phase Y `(binding)` criterion cites an integration test that runs the migration against an actual `better-sqlite3` database file, inserts/updates/deletes rows through `SqliteDocumentStore`, round-trips a `MATCH` query through `nodes_fts`, and asserts both the `note_date` and `prompt_version` columns exist with the documented types, defaults, and indexes.

Out-of-scope Sn that belong to sibling stories are listed below with explicit routing. They are intentionally not covered here; reviewers should not ask STO-4 to grow into them.

**Out of scope — routed to other stories:**

*REQ-004 (hybrid and filters):*
- **REQ-004 S2** — hybrid-off vector-only parity → owned by **RET-5**.
- **REQ-004 S3** — RRF uses the ADR-012 fusion constant → owned by **RET-5**.
- **REQ-004 S5** — single `pathGlob` scopes the query → owned by **RET-6**.
- **REQ-004 S6** — multiple `pathGlobs` are unioned → owned by **RET-6**.
- **REQ-004 S10** — combining `pathGlobs` and `dateRange` AND-intersects → owned by **RET-6**.
- **REQ-004 S11** — chat-input slash-command filters → owned by **RET-6**.
- **REQ-004 S12** — zero-result filter collapse handoff → owned by **RET-5** and **RET-6**.
- **REQ-004 S13** — BM25 surfaces exact-keyword hit vector-only missed → owned by **RET-5**.
- **REQ-004 S14** — filters respected in content-only fallback → owned by **RET-5** and **RET-6**.
- **REQ-004 S15** — coarse BM25 restricted to summary-bearing node types → owned by **RET-5**.

*REQ-005 (structured summaries):*
- **REQ-005 S1** — `note` summary carries the breadth-preserving rubric → owned by **WKF-4**.
- **REQ-005 S2** — `topic`/`subtopic` summaries use the same rubric → owned by **WKF-4**.
- **REQ-005 S3** — per-field caps + length budget + truncation logging → owned by **WKF-4**.
- **REQ-005 S4** — rubric well-formed with empty fields → owned by **WKF-4**.
- **REQ-005 S8** — older-version summaries regenerate automatically → owned by **WKF-4**.
- **REQ-005 S10** — content-hash skip still fires when version is current → owned by **WKF-4**.

**Prerequisites:** [STO-1](STO-1.md), [STO-2](STO-2.md), [STO-3](STO-3.md) complete; ADRs [012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md), [013](../decisions/ADR-013-structured-note-summaries.md), [014](../decisions/ADR-014-temporal-and-path-filters.md) **Accepted**.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | Binds FTS5 as the keyword backend and the migration shape (`002_fts.sql` — external-content `nodes_fts` + triggers); bumps `RELATIONAL_USER_VERSION`; rebuild on additive application is explicitly allowed. |
| [`docs/decisions/ADR-013-structured-note-summaries.md`](../decisions/ADR-013-structured-note-summaries.md) | Binds the `summaries.prompt_version` column as the per-row stamp that drives version-based staleness; existing rows must survive migration. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Binds `note_meta.note_date TEXT NULL` (additive) + index as the column `dateRange` filters query; NULLs are permitted and excluded by `dateRange` callers. |
| [`docs/decisions/ADR-004-per-vault-index-storage.md`](../decisions/ADR-004-per-vault-index-storage.md) | Migration applies per-vault DB file; no cross-vault state. |
| [`docs/decisions/ADR-008-idempotent-indexing-state-machine.md`](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Migration must be idempotent and not disturb in-flight jobs; running it twice is a no-op. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (ADR-012, ADR-013, ADR-014 are Accepted as of 2026-04-16; ADR-004 and ADR-008 are inherited Accepted).
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries (per-vault SQLite under `var/…` per ADR-004; FTS5 + sqlite-vec co-resident in the same DB per ADR-012; additive migration per ADR-012 §3 and ADR-014 §4).
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs.
- [ ] Section 4b (Ports & Adapters) lists every port/adapter this story creates or modifies — here: `IDocumentStore` contract (unchanged shape, changed backing schema) and `SqliteDocumentStore` (the adapter whose real backing DB must accept the migration).
- [ ] Section 8a (Test Plan) is filled and **every AC ID** (including Phase Y and Phase Z) is referenced by at least one planned test row.
- [ ] For every adapter in Section 4b, Section 8a contains both a **contract test against the port** and an **integration test against the real backing service** (no mock of the boundary the adapter owns), and Phase Y has a `(binding)` criterion citing the integration test file.
- [ ] Every Gherkin `Sn` ID from the linked refined requirements whose `Implemented by:` annotation includes STO-4 is mapped to at least one acceptance test row in Section 8a — and every `Sn` that does **not** include STO-4 is explicitly routed to its owning story in §1.
- [ ] Phase Y includes at least one criterion with **non-mock** evidence where wrong-stack substitution is a risk — here, a real `better-sqlite3` build exercising FTS5 + sqlite-vec co-existence and the full migration.

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `002_fts.sql` runs **idempotently**: re-running `runMigrations(db)` on an already-migrated DB is a no-op. Idempotency is enforced via `CREATE … IF NOT EXISTS` for the virtual table, triggers, and indexes, and via `PRAGMA table_info(…)` column-existence checks in `migrate.ts` before each `ALTER TABLE … ADD COLUMN`.
2. **Y2** — `nodes_fts` is an **external-content** FTS5 table (`content='nodes', content_rowid='rowid'`) so content is not duplicated on disk; `AFTER INSERT`, `AFTER DELETE`, and `AFTER UPDATE` triggers on `nodes` keep the index in sync without app-level double-writes.
3. **Y3** — Tokenizer is `unicode61 remove_diacritics 1` — documented in `002_fts.sql` and in the user storage guide; richer tokenizers (porter-stemmed, language-specific) are out of scope per ADR-012 *Explicit non-decisions*.
4. **Y4** — After applying the migration, if `SELECT COUNT(*) FROM nodes_fts` is zero **and** `SELECT COUNT(*) FROM nodes` is positive, `migrate.ts` runs `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` exactly once and logs a single `info` line recording that the rebuild fired.
5. **Y5** — `note_meta.note_date` is `TEXT NULL` (ISO `YYYY-MM-DD` shape enforced by [RET-6](RET-6.md) writers, not by a CHECK constraint). Index `idx_note_meta_note_date` is created on `note_date`. NULLs are permitted; the `dateRange` predicate in [RET-6](RET-6.md) is responsible for excluding them per ADR-014 §4.
6. **Y6** — `summaries.prompt_version` is `TEXT NOT NULL DEFAULT 'legacy'`; pre-existing `summaries` rows are backfilled to `'legacy'` on migration so [WKF-4](WKF-4.md)'s version-based staleness path can treat them as stale. Index `idx_summaries_prompt_version` is created on `prompt_version`.
7. **Y7** — Migration is **purely additive**: it does not drop, rename, re-type, or otherwise rewrite any existing column; `better-sqlite3` sees a consistent DB throughout. The FTS5 `rebuild` step, which SQLite recommends running outside a transaction, is the only step outside the `db.transaction(() => { … })` wrapper — that choice is documented inline in `migrate.ts`.
8. **Y8** — The migration only runs via `src/sidecar/db/migrate.ts`; no application code issues FTS5 DDL, `ALTER TABLE`, or rebuild commands outside the migration path. `SqliteDocumentStore` reads and writes through the migrated schema but does not create or alter it.

---

## 4b. Ports & Adapters

This story does not add any new port **methods**, but it changes the backing **schema** that `SqliteDocumentStore` implements `IDocumentStore` on top of. FTS5 use (`searchContentKeyword`) is introduced by [RET-5](RET-5.md) once STO-4 lands; `note_date` writes are introduced by [RET-6](RET-6.md); `prompt_version` writes are introduced by [WKF-4](WKF-4.md). STO-4's obligation is that `SqliteDocumentStore` continues to satisfy the `IDocumentStore` contract **on a DB that has had migration 002 applied**, with no silent substitution of the backing store.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IDocumentStore` | `src/core/ports/IDocumentStore.ts` | `SqliteDocumentStore` (`src/sidecar/adapters/SqliteDocumentStore.ts`) | real `better-sqlite3` DB file under `var/test/sto-4-migrations.db` with `nodes`, `note_meta`, `summaries` plus FTS5 + sqlite-vec extensions loaded | Existing port, modified backing schema. STO-4's binding evidence is the integration test that exercises the migration end-to-end against this real backing service; the contract test ensures any `IDocumentStore` implementation we ship continues to satisfy the documented shape after the schema delta lands. |

STO-4's binding evidence is the integration test against real `better-sqlite3` exercising the migration and FTS5 triggers (see Phase Y / §8a row 6). The contract test (§8a row 5) pins the shape of `IDocumentStore` so RET-5's upcoming `searchContentKeyword` extension lands against a stable surface.

---

## 5. API Endpoints + Schemas

No new or modified HTTP routes. The authoritative SQL delta is `002_fts.sql`, carried over verbatim:

```sql
-- 002_fts.sql: FTS5 keyword index + temporal column + prompt version column.

-- 1. FTS5 virtual table mirrored from nodes.content
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    content,
    content='nodes',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 1'
);

-- Keep FTS in sync with nodes
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO nodes_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- 2. Temporal metadata on note_meta
-- (migrate.ts guards with column-existence check; raw SQL here assumes fresh DB)
ALTER TABLE note_meta ADD COLUMN note_date TEXT;
CREATE INDEX IF NOT EXISTS idx_note_meta_note_date ON note_meta(note_date);

-- 3. Prompt version on summaries (backfill to 'legacy' for existing rows)
ALTER TABLE summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS idx_summaries_prompt_version ON summaries(prompt_version);
```

**`migrate.ts` changes.** Add a `runMigration002` function that, in order:

1. Checks `PRAGMA table_info(note_meta)` for `note_date` before the `ALTER`; skips the `ALTER` if present. Creates `idx_note_meta_note_date` if missing.
2. Checks `PRAGMA table_info(summaries)` for `prompt_version` before the `ALTER`; skips the `ALTER` if present. Creates `idx_summaries_prompt_version` if missing.
3. Executes the FTS5 `CREATE VIRTUAL TABLE` + `CREATE TRIGGER` block (all guarded with `IF NOT EXISTS`).
4. Checks `SELECT COUNT(*) FROM nodes_fts` vs `SELECT COUNT(*) FROM nodes`; when `nodes_fts` is empty but `nodes` is not, runs `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` once and logs at `info`.

Steps 1–3 run inside a single `db.transaction(() => { … })`. Step 4 runs **outside** the transaction because SQLite FTS5 `'rebuild'` commands cannot execute inside a transaction — this choice is documented inline in `migrate.ts` and called out in the user storage guide.

No changes to `IDocumentStore`'s method signatures in `src/core/ports/IDocumentStore.ts`. No changes to `shared/types.ts`.

---

## 6. Frontend Flow

Not applicable — STO-4 is infrastructure only. No `SearchView`, `ChatView`, or settings-surface changes.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/db/migrations/002_fts.sql` | Authoritative SQL delta: FTS5 virtual table + triggers, `note_meta.note_date` + index, `summaries.prompt_version` + index. |
| 2 | `tests/sidecar/db/migrations.002.test.ts` | Unit / integration tests for `runMigration002`: fresh apply, idempotent re-apply, schema assertions, trigger behavior, column backfill. |
| 3 | `tests/sidecar/db/migrations.002.rebuild.test.ts` | Rebuild-path integration test: seeded `nodes` with empty `nodes_fts` → migration populates `nodes_fts`. |
| 4 | `tests/contract/document-store.contract.ts` | Generic contract test suite for any `IDocumentStore` implementation — exercises round-trip semantics of `upsertNodes`, `upsertSummary`, and `upsertNoteMeta` against the migrated schema. |
| 5 | `tests/integration/sqlite-document-store.migration-002.test.ts` | Binding-evidence integration test: wires the contract against a real `better-sqlite3` file with FTS5 + sqlite-vec loaded, after `runMigrations` has applied 001 and 002. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/sidecar/db/migrate.ts` | Load and apply `002_fts.sql` after `001_relational.sql`; implement `runMigration002` with column-existence guards and the rebuild helper per §5. |
| 2 | `src/sidecar/adapters/SqliteDocumentStore.ts` | No signature changes. Ensure writes through `upsertNodes`, `deleteNote`, and node-content updates flow through the triggers (no direct raw-SQL paths that bypass `nodes_fts`). Confirm `upsertNoteMeta` leaves `note_date` as `NULL` when callers omit it. |
| 3 | `docs/guides/user-storage-and-uninstall.md` | Document the additive migration (FTS5 + `note_date` + `prompt_version`), the rebuild-on-startup condition, and that a full reindex is also an acceptable upgrade path. |
| 4 | `README.md` §8 (SQLite Schema) | Document the new virtual table, triggers, columns, and indexes, and their owning downstream stories ([RET-5](RET-5.md), [RET-6](RET-6.md), [WKF-4](WKF-4.md)). |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/db/migrations/001_relational.sql` — not edited; migration 002 is strictly additive.
- `src/core/ports/IDocumentStore.ts` — no port methods added by STO-4 (RET-5 adds `searchContentKeyword`).
- `shared/types.ts` — no type changes.
- `src/core/workflows/SummaryWorkflow.ts` — version-based staleness logic belongs to [WKF-4](WKF-4.md).
- `src/core/workflows/SearchWorkflow.ts` — hybrid retrieval and filter push-down belong to [RET-5](RET-5.md) and [RET-6](RET-6.md).

---

## 8. Acceptance Criteria Checklist

### Phase A: Migration mechanics

- [x] **A1** — Fresh DB apply: `runMigrations(db)` runs `001_relational.sql` then `002_fts.sql` against a freshly-opened temp DB without error; afterwards `sqlite_master` lists `nodes_fts`, `idx_note_meta_note_date`, and `idx_summaries_prompt_version`.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::A1_fresh_apply(vitest)`
- [x] **A2** — Idempotent re-apply: `runMigrations(db)` called twice in a row against the same DB is a no-op; the second invocation emits no errors, does not attempt the `ALTER TABLE` statements (verified via `PRAGMA table_info` pre-checks), and does not re-fire the rebuild log line.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::A2_idempotent(vitest)`

### Phase B: FTS5 sync triggers

- [x] **B1** — Insert/delete/update triggers: inserting a row into `nodes` creates a matching row in `nodes_fts` with identical `rowid`; deleting the row removes it from `nodes_fts`; updating `nodes.content` rebuilds that row's content in `nodes_fts`.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::B1_triggers(vitest)`
- [x] **B2** — BM25 round-trip: with a 3-row `nodes` fixture containing "Acme Corp", "acme corp", and "unrelated text", a `SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH 'acme'` returns the two Acme rows (ordered by BM25) and not the unrelated row.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::B2_match_bm25(vitest)`

### Phase C: Rebuild path

- [x] **C1** — Rebuild fires when `nodes_fts` is empty but `nodes` is not: given a DB where `nodes` has 3 rows and `nodes_fts` has 0 (simulating a raw-SQL state where the virtual table was created without the rebuild step), re-running `runMigrations(db)` populates `nodes_fts` with those 3 rows and logs one `info` line recording the rebuild.
  - Evidence: `tests/sidecar/db/migrations.002.rebuild.test.ts::C1_rebuild(vitest)`
- [x] **C2** — No spurious rebuild: when `nodes_fts` and `nodes` are both in sync, re-running `runMigrations(db)` does not issue `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` and does not log the rebuild line.
  - Evidence: `tests/sidecar/db/migrations.002.rebuild.test.ts::C2_no_rebuild_when_synced(vitest)`

### Phase D: Column additions and backfill

- [x] **D1** — Column shape: after migration, `PRAGMA table_info(note_meta)` lists `note_date` with `type='TEXT'` and `notnull=0`; `PRAGMA table_info(summaries)` lists `prompt_version` with `type='TEXT'`, `notnull=1`, and `dflt_value='''legacy'''` (or equivalent quoted-literal representation).
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::D1_columns(vitest)`
- [x] **D2** — Backfill: seed a DB with a `summaries` row written under 001 only, apply 002, and assert the pre-existing row ends up with `prompt_version = 'legacy'`.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::D2_backfill(vitest)`
- [x] **D3** — NULL `note_date` permitted: seed a `note_meta` row with no `note_date` value (i.e. leave the column NULL) through `upsertNoteMeta`; round-trip read returns `note_date = NULL`.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::D3_note_date_null(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `002_fts.sql` runs idempotently via `runMigrations` twice against the same real `better-sqlite3` file; second call is a no-op.
  - Evidence: `tests/integration/sqlite-document-store.migration-002.test.ts::Y1_idempotent_against_real_sqlite(vitest)`
- [x] **Y2** — **(binding)** `nodes_fts` is external-content (`content='nodes', content_rowid='rowid'`) and FTS5 + sqlite-vec extensions co-exist in the loaded build; asserted via `PRAGMA module_list` / reflection and a round-trip MATCH query.
  - Evidence: `tests/integration/sqlite-document-store.migration-002.test.ts::Y2_external_content_and_extensions(vitest)`
- [x] **Y3** — **(binding)** Tokenizer is declared as `unicode61 remove_diacritics 1`; asserted by grepping the migration file and by inspecting `sqlite_master.sql` for `nodes_fts`.
  - Evidence: `scripts/verify-stack.mjs(npm run verify:stack)` — checks the literal string in `src/sidecar/db/migrations/002_fts.sql`.
- [x] **Y4** — **(binding)** Rebuild fires exactly once when `nodes_fts` is empty and `nodes` is not, and logs a single `info` line; no rebuild fires when the two are already in sync.
  - Evidence: `tests/integration/sqlite-document-store.migration-002.test.ts::Y4_rebuild_once(vitest)`
- [x] **Y5** — **(binding)** `note_meta.note_date` exists as `TEXT NULL` with index `idx_note_meta_note_date`; asserted against a real migrated DB via `PRAGMA table_info` + `sqlite_master`.
  - Evidence: `tests/integration/sqlite-document-store.migration-002.test.ts::Y5_note_date_column_and_index(vitest)`
- [x] **Y6** — **(binding)** `summaries.prompt_version` exists as `TEXT NOT NULL DEFAULT 'legacy'` with index `idx_summaries_prompt_version`; pre-existing rows are backfilled to `'legacy'`; asserted against a real migrated DB.
  - Evidence: `tests/integration/sqlite-document-store.migration-002.test.ts::Y6_prompt_version_column_and_backfill(vitest)`
- [x] **Y7** — **(binding)** Migration is additive: running 002 against a DB with seeded `nodes`, `note_meta`, `summaries`, and vector rows does not drop, rename, or re-type any column from 001; every seeded row is still present and readable post-migration.
  - Evidence: `tests/integration/sqlite-document-store.migration-002.test.ts::Y7_additive_no_data_loss(vitest)`
- [x] **Y8** — **(binding)** `IDocumentStore` contract round-trip holds against the migrated `SqliteDocumentStore`: contract-suite rows for `upsertNodes`, `upsertSummary`, and `upsertNoteMeta` pass unchanged, proving the schema delta did not break the port.
  - Evidence: `tests/contract/document-store.contract.ts::contract_round_trip(vitest)` wired in `tests/integration/sqlite-document-store.migration-002.test.ts::Y8_contract_roundtrip_on_migrated_schema(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces.
  - Evidence: `npm run build`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings).
  - Evidence: `npm run lint`
- [x] **Z3** — No `any` types in any new or modified file (`src/sidecar/db/migrate.ts`, the new test files, the contract test, and any helper).
  - Evidence: `scripts/verify-stack.mjs(npm run verify:stack)` — greps for `: any` / `as any` in the changed surface.
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — not applicable to STO-4's sidecar-only files; confirm by grep.
  - Evidence: `scripts/verify-stack.mjs(npm run verify:stack)` — greps the changed surface for relative `shared/types` imports.
- [x] **Z5** — New or modified code includes appropriate logging: migration start/finish and rebuild-fired flag at `info`; column-already-present shortcut at `debug`; unexpected SQL errors bubble up with the migration step name.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::Z5_logs_at_info(vitest)`
- [x] **Z6** — `/review-story STO-4` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output).
  - Evidence: `/review-story STO-4` summary line.

---

## 8a. Test Plan

Every AC ID from Section 8 appears in the **Covers AC** column of at least one row. Every Gherkin `Sn` from REQ-004 and REQ-005 whose `Implemented by:` annotation includes STO-4 appears in **Covers Sn** of at least one row, namespaced as `REQ-004 Sn` or `REQ-005 Sn` to avoid collision. Per `~/.cursor/AGENTS.md` rule 2, `IDocumentStore` gets one `contract` row and `SqliteDocumentStore` gets one `integration` row against the real `better-sqlite3` backing service.

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/sidecar/db/migrations.002.test.ts::A1_fresh_apply` | A1 | REQ-004 S4 | Fresh DB; asserts virtual table + indexes exist post-migration. |
| 2 | unit | `tests/sidecar/db/migrations.002.test.ts::A2_idempotent` | A2 | REQ-004 S4 | Second invocation is a no-op. |
| 3 | unit | `tests/sidecar/db/migrations.002.test.ts::B1_triggers` | B1 | REQ-004 S1, REQ-004 S4 | Insert/delete/update trigger coverage. |
| 4 | unit | `tests/sidecar/db/migrations.002.test.ts::B2_match_bm25` | B2 | REQ-004 S1, REQ-004 S4 | BM25 `MATCH` round-trip on a 3-row fixture. |
| 5 | unit | `tests/sidecar/db/migrations.002.test.ts::D1_columns` | D1 | REQ-004 S7, REQ-004 S8, REQ-004 S9, REQ-005 S7, REQ-005 S9 | `PRAGMA table_info` shape for `note_date` and `prompt_version`. |
| 6 | unit | `tests/sidecar/db/migrations.002.test.ts::D2_backfill` | D2 | REQ-005 S7, REQ-005 S9 | Pre-existing `summaries` rows → `prompt_version = 'legacy'`. |
| 7 | unit | `tests/sidecar/db/migrations.002.test.ts::D3_note_date_null` | D3 | REQ-004 S7, REQ-004 S8, REQ-004 S9 | NULL `note_date` is permitted; round-trip preserves NULL. |
| 8 | unit | `tests/sidecar/db/migrations.002.test.ts::Z5_logs_at_info` | Z5 | REQ-004 S4, REQ-005 S9 | Verifies `info` log lines for migration start/finish + rebuild-fired. |
| 9 | unit | `tests/sidecar/db/migrations.002.rebuild.test.ts::C1_rebuild` | C1 | REQ-004 S4 | Empty `nodes_fts` + non-empty `nodes` → rebuild fires. |
| 10 | unit | `tests/sidecar/db/migrations.002.rebuild.test.ts::C2_no_rebuild_when_synced` | C2 | REQ-004 S4 | Synced state → rebuild does not fire. |
| 11 | contract | `tests/contract/document-store.contract.ts::contract_round_trip` | Y8 | REQ-004 S1, REQ-004 S7, REQ-004 S8, REQ-004 S9, REQ-005 S5, REQ-005 S6, REQ-005 S7, REQ-005 S9 | Port-level round-trip for `upsertNodes`, `upsertSummary`, `upsertNoteMeta`; runs against every `IDocumentStore` adapter. |
| 12 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y1_idempotent_against_real_sqlite` | Y1 | REQ-004 S4 | Binding — real `better-sqlite3`, runMigrations twice, no-op on second call. |
| 13 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y2_external_content_and_extensions` | Y2 | REQ-004 S1, REQ-004 S4 | Binding — external-content FTS5 + sqlite-vec co-exist; MATCH round-trip. |
| 14 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y4_rebuild_once` | Y4 | REQ-004 S4 | Binding — rebuild path fires exactly once against real SQLite. |
| 15 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y5_note_date_column_and_index` | Y5 | REQ-004 S7, REQ-004 S8, REQ-004 S9 | Binding — `note_date` column + index exist against real SQLite. |
| 16 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y6_prompt_version_column_and_backfill` | Y6 | REQ-005 S7, REQ-005 S9 | Binding — `prompt_version` column, default, index, and backfill against real SQLite. |
| 17 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y7_additive_no_data_loss` | Y7 | REQ-004 S7, REQ-005 S7, REQ-005 S9 | Binding — seeded data survives migration intact. |
| 18 | integration | `tests/integration/sqlite-document-store.migration-002.test.ts::Y8_contract_roundtrip_on_migrated_schema` | Y8 | REQ-005 S5, REQ-005 S6, REQ-005 S7 | Binding — wires the contract suite (row 11) against the migrated real-SQLite adapter so `bullet_group` write paths stay well-defined on the new schema. |
| 19 | script | `scripts/verify-stack.mjs(npm run verify:stack)` | Y3, Z3, Z4 | REQ-004 S4 | Static checks: tokenizer literal in `002_fts.sql`; no `any`; no relative `shared/types` imports. |
| 20 | e2e | `/review-story STO-4` | Z6 | — | Machine-checkable zero-high-finding summary line on the changed surface. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | FTS5 is not compiled into the bundled `better-sqlite3`, so the migration fails on a user machine with a cryptic error. | Sidecar install / startup probe verifies FTS5 is available before running 002 and logs a clear, actionable error if missing; Y2 asserts co-existence of FTS5 and sqlite-vec on the integration path. |
| 2 | Large vaults face a long one-time FTS5 `rebuild` on first upgrade. | The rebuild runs on startup, outside the main request path; logged at `info` so operators can observe it; a future story can move it to the background indexer if duration becomes user-visible. |
| 3 | Triggers can drift out of sync if some future code path bypasses `SqliteDocumentStore.upsertNodes` with raw SQL. | Y8 (boundaries) forbids raw DDL / direct `nodes` writes outside the adapter; the rebuild helper is a documented repair path and re-runs via empty-`nodes_fts` detection. |
| 4 | `ALTER TABLE` on large tables briefly locks the DB. | Migration runs once on startup before worker threads spin up; the time cost is bounded by table size and is acceptable for an additive column add; documented in the user storage guide. |
| 5 | FTS5 `'rebuild'` must run outside a transaction, which breaks the "one atomic migration" invariant. | The split is intentional and documented inline in `migrate.ts`: steps 1–3 are transactional; step 4 is a clearly-scoped single statement whose failure mode (rebuild not fired) is self-healing on the next startup via the empty-`nodes_fts` check. |
| 6 | `prompt_version = 'legacy'` backfill creates a large class of "stale" summaries that [WKF-4](WKF-4.md) will want to regenerate on the next run. | Intentional: §1 calls this out as the auto-upgrade path required by REQ-005 S8. STO-4 does not regenerate anything itself. |

---

## Implementation Order

1. `src/sidecar/db/migrations/002_fts.sql` — write the authoritative SQL delta from §5 (covers A1, B1, B2, D1, D3).
2. `src/sidecar/db/migrate.ts` — add `runMigration002` with `PRAGMA table_info` guards, `CREATE … IF NOT EXISTS` block, and the rebuild helper; log migration start/finish + rebuild-fired at `info`; wire it after `runMigration001` (covers A1, A2, C1, C2, D2, Z5).
3. `tests/sidecar/db/migrations.002.test.ts` — write the unit tests red-first (A1, A2, B1, B2, D1, D2, D3, Z5) before adjusting `migrate.ts` finalization.
4. `tests/sidecar/db/migrations.002.rebuild.test.ts` — write the rebuild-path tests red-first (C1, C2).
5. **Verify** — `npm test -- migrations.002` locally; `PRAGMA table_info` assertions green; BM25 round-trip green.
6. `tests/contract/document-store.contract.ts` — extract/author the `IDocumentStore` contract suite around `upsertNodes`, `upsertSummary`, and `upsertNoteMeta` (covers Y8).
7. `tests/integration/sqlite-document-store.migration-002.test.ts` — wire the real `better-sqlite3` file fixture, run `runMigrations`, exercise seeded-data survival, and run the contract suite from step 6 against the migrated store (covers Y1, Y2, Y4, Y5, Y6, Y7, Y8).
8. `src/sidecar/adapters/SqliteDocumentStore.ts` — confirm no adapter code bypasses `nodes_fts` triggers; leave `note_date` / `prompt_version` writes as pass-through (covers Y2, Y8).
9. `scripts/verify-stack.mjs` — extend (or add) tokenizer-literal grep, `any`-type grep, and relative-`shared/types`-import grep for the changed surface (covers Y3, Z3, Z4).
10. `docs/guides/user-storage-and-uninstall.md` — document the additive migration, the rebuild-on-empty behavior, and the reindex-as-alternative-upgrade-path.
11. `README.md` §8 — document the new virtual table, triggers, columns, and indexes with owning-story links.
12. **Final verify** — `npm run build`, `npm run lint`, `npm test`, `npm run verify:stack`, `/review-story STO-4` (covers Z1, Z2, Z3, Z4, Z6).

---

*Created: 2026-04-20 | Story: STO-4 | Epic: 3 — SQLite store, vectors, and indexing persistence*
