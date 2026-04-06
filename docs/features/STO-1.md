# STO-1: SQLite migrations for relational schema and queue/job tables

**Story**: Ship versioned sidecar migrations that create the **relational** SQLite tables from README §8 — `nodes`, `summaries`, `tags`, `cross_refs`, `note_meta`, `queue_items`, and `job_steps` — with indexes and `CHECK` constraints matching the canonical schema, **excluding** `vec0` virtual tables and `embedding_meta` (deferred to STO-2).
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story establishes the **durable relational foundation** for the index: hierarchical nodes, summaries, tags, cross-references, note-level metadata for incremental indexing, and the persistence backing for the in-process queue and per-note job state machine. It implements [README §8 SQLite Schema](../../README.md#8-sqlite-schema) for every **non-vector** table and aligns literal `CHECK` values with [src/core/domain/types.ts](../../src/core/domain/types.ts) (`NodeType`, `IndexStep`, queue `status`).

**Out of scope here (STO-2):** `vec_content`, `vec_summary`, and `embedding_meta`. Migrations must be ordered so STO-2 can append vector DDL without rewriting STO-1 tables.

The runner opens SQLite only in the **sidecar** process using native `better-sqlite3` ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)); the plugin bundle must never gain SQLite imports ([FND-1](FND-1.md), `scripts/check-source-boundaries.mjs`). Database **file path and lazy open** follow [ADR-004](../decisions/ADR-004-per-vault-index-storage.md) — this story supplies **schema application**; wiring `dbPath` from settings into the opener is allowed here as minimal glue in `src/sidecar/` if needed for tests, or may stay test-only until SRV-1 — **prefer** a small `openDatabase(path)` + `migrate()` API callable from future server bootstrap.

Pointers: [docs/requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §12 (local SQLite in sidecar); ADR-004; ADR-006; [ADR-007](../decisions/ADR-007-queue-abstraction.md) (`queue_items`); [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) (`job_steps`).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                                      | Why it binds this story                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-004-per-vault-index-storage.md](../decisions/ADR-004-per-vault-index-storage.md)                     | Per-vault DB file, lazy migrate on first use — migrations must be safe to run once per path. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)                           | `better-sqlite3` and all DDL execute only in the sidecar; plugin stays thin.                 |
| [docs/decisions/ADR-007-queue-abstraction.md](../decisions/ADR-007-queue-abstraction.md)                                 | `queue_items` shape and status vocabulary for crash-safe queue persistence.                  |
| [docs/decisions/ADR-008-idempotent-indexing-state-machine.md](../decisions/ADR-008-idempotent-indexing-state-machine.md) | `job_steps` columns and `current_step` CHECK literals.                                       |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — DDL for `nodes`, `summaries`, `tags`, `cross_refs`, `note_meta`, `queue_items`, and `job_steps` matches README §8 column names, types, `FOREIGN KEY` / `ON DELETE CASCADE` behavior, indexes, and `CHECK` enumerations (including `nodes.type` and `job_steps.current_step` spellings).
2. **Y2** — **No** `CREATE VIRTUAL TABLE ... vec0` and **no** `embedding_meta` table in this story’s migration set — those belong to STO-2 only.
3. **Y3** — Migration code runs only under `src/sidecar/**` (or `scripts/` dev tools if explicitly shared); `src/core/**` and `src/plugin/**` remain free of `better-sqlite3` imports per existing boundary checks.
4. **Y4** — Migrations are **versioned** and **idempotent** for a fresh DB: running the full chain twice on an already-migrated DB must not error (use `IF NOT EXISTS` patterns consistent with README examples or an equivalent user_version strategy).
5. **Y5** — `queue_items.status` values are exactly: `pending`, `processing`, `completed`, `dead_letter` (README §8).
6. **Y6** — `heading_trail` in `nodes` is stored as TEXT holding a **JSON array of strings** at the SQL boundary (matches README comment); no separate table for trails in MVP.

---

## 5. API Endpoints + Schemas

No HTTP routes in this story. Expose a **sidecar-internal** TypeScript API only, for example:

| Attribute | Value                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------- |
| Surface   | `runMigrations(db: Database, options?) => void` or `migrateToLatest(path: string) => Database` |
| Auth      | N/A                                                                                            |

```ts
/** Example — Implementer may use better-sqlite3's actual Database type. */
export interface MigrationContext {
  /** Monotonic migration id (1 = STO-1 baseline relational schema). */
  readonly version: number;
  readonly id: string;
  readonly up: (db: unknown) => void;
}

export function runRelationalMigrations(db: unknown): void;
```

No changes to `shared/types.ts` are required if none exists for this MVP layout; domain types already live in `src/core/domain/types.ts`.

---

## 6. Frontend Flow

Not applicable. Sidecar database initialization only.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                                   | Purpose                                                                                              |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `src/sidecar/db/migrations/001_relational.sql` (or `.ts` embedded SQL) | STO-1 DDL matching README §8 (non-vector tables only).                                               |
| 2   | `src/sidecar/db/migrate.ts`                                            | Version tracking (`PRAGMA user_version` or `_migrations` table), ordered apply, idempotent behavior. |
| 3   | `src/sidecar/db/open.ts` (optional)                                    | `better-sqlite3` open helper for tests and future SRV-1.                                             |
| 4   | `tests/sidecar/db/migrate.test.ts`                                     | Applies migrations to `:memory:` DB and asserts tables/indexes exist.                                |

### Files to MODIFY

| #   | Path                  | Change                                                                                                  |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `package.json`        | Add runtime dependency `better-sqlite3` (and `@types/better-sqlite3` if needed as devDependency).       |
| 2   | `esbuild.sidecar.mjs` | Keep `better-sqlite3` externalized; confirm sidecar bundle still runs with `node` after native install. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/**` — schema is sidecar-only; core stays storage-agnostic.
- `src/plugin/**` — no SQLite in plugin ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)).

---

## 8. Acceptance Criteria Checklist

### Phase A: Migration content parity

- [x] **A1** — After running STO-1 migrations on a fresh database, `sqlite_master` (or pragma) shows all seven tables: `nodes`, `summaries`, `tags`, `cross_refs`, `note_meta`, `queue_items`, `job_steps`.
  - Verification: Programmatic introspection or `PRAGMA table_info` for each name.
  - Evidence: `tests/sidecar/db/migrate.test.ts::A1_tables_exist(vitest)`

- [x] **A2** — Indexes from README §8 exist for `nodes` (note, parent, type, hash), `tags`, `cross_refs`, `queue_items`, and `job_steps`.
  - Verification: Query `sqlite_master` for expected index names or indexed columns.
  - Evidence: `tests/sidecar/db/migrate.test.ts::A2_indexes_exist(vitest)`

- [x] **A3** — Inserting invalid `nodes.type`, `queue_items.status`, or `job_steps.current_step` values fails at the database layer (CHECK constraint).
  - Verification: Wrapped `INSERT` expectations for rejection.
  - Evidence: `tests/sidecar/db/migrate.test.ts::A3_check_constraints(vitest)`

### Phase B: Idempotency and ordering

- [x] **B1** — Running the migration runner twice on the same database file does not throw and leaves schema unchanged.
  - Evidence: `tests/sidecar/db/migrate.test.ts::B1_idempotent(vitest)`

- [x] **B2** — Migration version metadata records completion of STO-1 baseline (e.g. `user_version >= 1` or dedicated migrations table row).
  - Evidence: `tests/sidecar/db/migrate.test.ts::B2_version_recorded(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `better-sqlite3` is declared in root `package.json` dependencies (sidecar consumes it); `src/plugin/**` contains no `better-sqlite3` or `sqlite-vec` import strings.
  - Verification: `npm run check:boundaries` passes; manual grep optional.
  - Evidence: `scripts/check-source-boundaries.mjs(npm run check:boundaries)` and `package.json lists "better-sqlite3"`

- [x] **Y2** — **(binding)** STO-1 migration artifacts contain **no** substring `vec0` and **no** `CREATE VIRTUAL TABLE` for vectors (grep of migration sources).
  - Evidence: `tests/sidecar/db/migrate.test.ts::Y2_no_vec_ddl(vitest)` or `rg "vec0|CREATE VIRTUAL TABLE" src/sidecar/db/migrations` exits 1

- [x] **Y3** — **(binding)** `npm run verify:plugin-bundle` still passes — plugin output must not pick up native SQLite stack markers.
  - Evidence: `scripts/verify-plugin-bundle.mjs(npm run verify:plugin-bundle)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A if this story touches no shared client; then state **N/A verified** in PR description
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                                | Mitigation                                                                                              |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `better-sqlite3` native build friction on contributor machines | Document Node ≥ 18 + build tools in README developer section when adding dep; optional CI matrix later. |
| 2   | Future schema drift vs README                                  | Single source of truth: update README §8 + migration + this doc in one PR when changing DDL.            |

---

## Implementation Order

1. Add `better-sqlite3` to `package.json` and ensure sidecar build still runs.
2. Author `001_relational.sql` (or equivalent) verbatim from README §8 minus vector/embedding sections.
3. Implement `migrate.ts` with `user_version` (or migrations table) bump to **1** for STO-1.
4. Write `migrate.test.ts` covering A1–A3, B1–B2, Y2.
5. **Verify** — `npm run test`, `npm run check:boundaries`, `npm run verify:plugin-bundle`, `npm run build`.
6. **Final verify** — full build + optional manual `sqlite3` CLI open of migrated temp file.

---

_Created: 2026-04-05 | Story: STO-1 | Epic: 3 — SQLite store, vectors, and indexing persistence_
