# STO-4: FTS5 index, prompt-version, and temporal metadata migration

**Story**: Add SQLite migration **`002_fts.sql`** to create an **FTS5 virtual table** (`nodes_fts`) over `nodes.content` with external-content mode + triggers to stay in sync with `nodes`; add `note_meta.note_date` and `summaries.prompt_version` columns supporting [RET-6](RET-6.md) and [WKF-4](WKF-4.md); extend `migrate.ts` to apply `002_fts.sql` idempotently and to optionally **rebuild** the FTS index when it is missing rows on startup.
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Medium
**Status**: Planned

---

## 1. Summary

Phase B of the grounding/retrieval plan needs three schema-level changes grouped into a single additive migration to keep user upgrades simple:

1. **FTS5 over `nodes.content`** — required by [RET-5](RET-5.md) for BM25 keyword search; wired with triggers so writes to `nodes` stay mirrored without app-level double writes.
2. **`note_meta.note_date TEXT NULL`** — required by [RET-6](RET-6.md) for daily-note temporal filtering; populated by the indexer from filename parsing.
3. **`summaries.prompt_version TEXT`** — required by [WKF-4](WKF-4.md) so the summary workflow can invalidate stale prose summaries when the prompt template changes.

The migration is **purely additive**: existing data is preserved; FTS5 is populated by `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` on first apply, and a startup check in `migrate.ts` triggers a rebuild if the virtual table is empty but `nodes` is not.

**Prerequisites:** [STO-1](STO-1.md), [STO-2](STO-2.md), [STO-3](STO-3.md) complete; ADRs [012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md), [013](../decisions/ADR-013-structured-note-summaries.md), [014](../decisions/ADR-014-temporal-and-path-filters.md) **Accepted**.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                             | Why it binds this story                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | FTS5 virtual table is the backing store for BM25 in hybrid retrieval.     |
| [docs/decisions/ADR-014-temporal-and-path-filters.md](../decisions/ADR-014-temporal-and-path-filters.md)         | `note_meta.note_date` is the column filters query.                        |
| [docs/decisions/ADR-013-structured-note-summaries.md](../decisions/ADR-013-structured-note-summaries.md)         | `summaries.prompt_version` drives per-version staleness.                  |
| [docs/decisions/ADR-004-per-vault-index-storage.md](../decisions/ADR-004-per-vault-index-storage.md)             | Migration applies per-vault DB file.                                      |
| [docs/decisions/ADR-008-idempotent-indexing-state-machine.md](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Migration must be idempotent and not disturb in-flight jobs.              |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs do not contradict each other
- [ ] Section 4 (Binding constraints) is filled
- [ ] Phase Y has at least one criterion with non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `002_fts.sql` runs **idempotently**: re-running the migration on an already-migrated DB is a no-op (guards via `CREATE ... IF NOT EXISTS` and column-existence checks performed in `migrate.ts`).
2. **Y2** — `nodes_fts` is an **external-content** FTS5 table (`content='nodes', content_rowid='rowid'`) so content is not duplicated; triggers keep it synced for `INSERT`/`UPDATE`/`DELETE` on `nodes`.
3. **Y3** — Tokenizer is `unicode61` with `remove_diacritics 1` — documented; advanced tokenizers are a future concern.
4. **Y4** — After migration, if `(SELECT COUNT(*) FROM nodes_fts)` is zero and `(SELECT COUNT(*) FROM nodes)` is positive, `migrate.ts` runs `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` once and logs at `info`.
5. **Y5** — `note_meta.note_date` is `TEXT NULL` (ISO `YYYY-MM-DD`); index `idx_note_meta_note_date` is created; NULLs are permitted.
6. **Y6** — `summaries.prompt_version` is `TEXT NOT NULL DEFAULT 'legacy'`; existing rows are backfilled to `'legacy'` so [WKF-4](WKF-4.md) can treat them as stale.
7. **Y7** — Migration does not drop or rename any existing column; `better-sqlite3` sees a consistent DB throughout.

---

## 5. API Endpoints + Schemas

Full SQL delta (authoritative):

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

**`migrate.ts` changes:** add a `runMigration002` function that:

1. Checks `PRAGMA table_info(note_meta)` for `note_date` before the `ALTER`.
2. Checks `PRAGMA table_info(summaries)` for `prompt_version` before the `ALTER`.
3. Executes the FTS5 CREATE/TRIGGER block.
4. Checks FTS5 row count vs `nodes` row count; triggers `rebuild` when needed.

All inside a single `db.transaction(() => { ... })` (except the `rebuild` step which FTS5 prefers outside a transaction — document the choice).

No new HTTP routes.

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

| #   | Path                                                | Purpose                                                           |
| --- | --------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | `src/sidecar/db/migrations/002_fts.sql`             | FTS5 virtual table + triggers + column additions + indexes.       |
| 2   | `tests/sidecar/db/migrations.002.test.ts`           | Applies migration to temp DB; asserts schema and idempotency.     |
| 3   | `tests/sidecar/db/migrations.002.rebuild.test.ts`   | Populates `nodes`, runs migration, asserts `nodes_fts` rebuilt.   |

### Files to MODIFY

| #   | Path                                                  | Change                                                                            |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | `src/sidecar/db/migrate.ts`                           | Load and apply `002_fts.sql` after `001_relational.sql`; add rebuild helper.      |
| 2   | `src/sidecar/adapters/SqliteDocumentStore.ts`         | Begin using `nodes_fts` in [RET-5](RET-5.md); `note_date` in [RET-6](RET-6.md).   |
| 3   | `README.md` §8 schema / data model                    | Document new columns + virtual table and their owning stories.                    |

### Files UNCHANGED

- `001_relational.sql` — not edited; migration is strictly additive.

---

## 8. Acceptance Criteria Checklist

### Phase A: Migration mechanics

- [ ] **A1** — Fresh temp DB → `migrate.ts` runs both `001_relational.sql` and `002_fts.sql` without error; virtual table and indexes exist.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::A1_fresh_apply`
- [ ] **A2** — Running `migrate.ts` twice against the same DB is a no-op; second run emits no errors.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::A2_idempotent`

### Phase B: FTS5 sync triggers

- [ ] **B1** — Inserting into `nodes` inserts a row into `nodes_fts`; deleting removes; updating rebuilds that row.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::B1_triggers`
- [ ] **B2** — `MATCH` query returns expected `rowid`s for a fixture of 3 rows.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::B2_match_bm25`

### Phase C: Rebuild path

- [ ] **C1** — Given a DB where `nodes` has rows but `nodes_fts` has none (simulating an older migration run), applying `002_fts.sql` populates `nodes_fts`.
  - Evidence: `tests/sidecar/db/migrations.002.rebuild.test.ts::C1_rebuild`

### Phase D: Column additions

- [ ] **D1** — `PRAGMA table_info(note_meta)` lists `note_date TEXT NULL`; `PRAGMA table_info(summaries)` lists `prompt_version TEXT NOT NULL DEFAULT 'legacy'`.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::D1_columns`
- [ ] **D2** — Pre-existing `summaries` rows end up with `prompt_version = 'legacy'` after migration.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::D2_backfill`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — `002_fts.sql` lives only under `src/sidecar/db/migrations/`; no application code issues raw DDL outside of `migrate.ts`.
  - Evidence: `npm run check:boundaries` + static grep.
- [ ] **Y2** — **(non-mock)** Migration runs against a real `better-sqlite3` build with sqlite-vec + FTS5 compiled in; integration test asserts both extensions co-exist.
  - Evidence: `tests/sidecar/db/migrations.002.test.ts::Y2_integration`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes
- [ ] **Z2** — `npm run lint` passes
- [ ] **Z3** — No `any` types
- [ ] **Z4** — N/A
- [ ] **Z5** — Log migration start/finish + rebuild-fired flag at `info`.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                              | Mitigation                                                                                                       |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1   | FTS5 not compiled into the bundled `better-sqlite3`           | Sidecar install script pins a version known to include FTS5; startup probe logs a clear error if missing.        |
| 2   | Large vaults face a long one-time `rebuild`                  | Run `rebuild` asynchronously after migration if necessary; logged and surfaced in progress slideout (future).    |
| 3   | FTS5 external-content triggers get out of sync if someone bypasses them with raw SQL | All writes route through `SqliteDocumentStore.upsertNodes`; rebuild helper can repair if invariants break. |
| 4   | Adding columns on large tables briefly locks the DB          | Migration runs once on startup before workers; time cost bounded and acceptable.                                 |

---

## Implementation Order

1. Draft `002_fts.sql`.
2. Extend `migrate.ts` with column-existence guards + rebuild helper.
3. Unit + integration tests.
4. Update README §8.
5. Full verify.

---

_Created: 2026-04-16 | Story: STO-4 | Epic: 3 — SQLite store, vectors, and indexing persistence_
