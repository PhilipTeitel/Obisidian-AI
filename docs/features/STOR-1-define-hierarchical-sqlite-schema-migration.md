# STOR-1: Define hierarchical SQLite schema migration

**Story**: Define the `003_hierarchical_model` migration that creates the hierarchical `nodes`, `node_children`, `node_summaries`, `node_embeddings`, `node_tags`, `node_cross_refs`, and `metadata` tables with all indexes, and drops the old flat `chunks`/`chunk_embeddings` tables.
**Epic**: Epic 12 — SQLite Hierarchical Storage Migration
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story adds the third schema migration to `vectorStoreSchema.ts` that transitions the storage layer from the flat chunk model to the hierarchical node model defined in HIER-1. The migration creates all tables specified in the README's Key Design Decision #5 (SQLite Schema for Hierarchical Model), including the `nodes` table for the document tree, `node_children` for ordered child relationships, `node_summaries` for LLM-generated summaries, `node_embeddings` (sqlite-vec virtual table) for vector search, `node_tags` for normalized tag indexing, `node_cross_refs` for wikilink tracking, and `metadata` for schema versioning.

The migration also drops the old `chunk_embeddings` and `chunk_embedding_vec_index` tables and their associated indexes, since the hierarchical model is a fundamentally different structural model that cannot be migrated in-place. A full reindex is required after this migration runs.

The migration follows the existing `VectorStoreMigration` pattern: an array of SQL `CREATE TABLE`, `CREATE INDEX`, `CREATE VIRTUAL TABLE`, and `DROP TABLE` statements. The `LocalVectorStoreRepository` currently uses these migrations only for metadata tracking (schema version, applied migration IDs) — it does not execute the SQL statements against a real SQLite database. The actual SQL execution will happen in STOR-2 when `SqliteVecRepository` is implemented. However, the migration statements must be valid SQL that will execute correctly against wa-SQLite + sqlite-vec.

This story has no runtime behavior changes. It is purely additive: the new migration is appended to the `VECTOR_STORE_MIGRATIONS` array. The existing `LocalVectorStoreRepository` will see an incremented `schemaVersion` and updated `appliedMigrationIds`, but its in-memory JSON-based storage continues to function identically.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The migration adds the following SQL schema (matching README Key Design Decision #5):

```sql
-- Document tree nodes
CREATE TABLE IF NOT EXISTS nodes (
  node_id       TEXT PRIMARY KEY,
  parent_id     TEXT,
  note_path     TEXT NOT NULL,
  note_title    TEXT NOT NULL,
  heading_trail TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  node_type     TEXT NOT NULL,
  content       TEXT NOT NULL,
  sequence_index INTEGER NOT NULL DEFAULT 0,
  content_hash  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);

-- Ordered child relationships
CREATE TABLE IF NOT EXISTS node_children (
  parent_id  TEXT NOT NULL,
  child_id   TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (parent_id, child_id),
  FOREIGN KEY (parent_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);

-- LLM-generated summaries
CREATE TABLE IF NOT EXISTS node_summaries (
  node_id        TEXT PRIMARY KEY,
  summary        TEXT NOT NULL,
  model_used     TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  generated_at   INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);

-- Vector embeddings via sqlite-vec
CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings USING vec0(
  node_id        TEXT PRIMARY KEY,
  embedding_type TEXT NOT NULL,
  embedding      FLOAT[1536]
);

-- Normalized tag index
CREATE TABLE IF NOT EXISTS node_tags (
  node_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (node_id, tag),
  FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);

-- Cross-references (wikilinks)
CREATE TABLE IF NOT EXISTS node_cross_refs (
  source_node_id TEXT NOT NULL,
  target_path    TEXT NOT NULL,
  target_display TEXT,
  FOREIGN KEY (source_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);

-- Schema metadata
CREATE TABLE IF NOT EXISTS metadata (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_note_path ON nodes(note_path);
CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_content_hash ON nodes(content_hash);
CREATE INDEX IF NOT EXISTS idx_node_children_parent ON node_children(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);
CREATE INDEX IF NOT EXISTS idx_node_tags_node ON node_tags(node_id);
CREATE INDEX IF NOT EXISTS idx_node_cross_refs_source ON node_cross_refs(source_node_id);
CREATE INDEX IF NOT EXISTS idx_node_cross_refs_target ON node_cross_refs(target_path);
CREATE INDEX IF NOT EXISTS idx_node_summaries_generated ON node_summaries(generated_at);
```

Drop old tables:

```sql
DROP TABLE IF EXISTS chunk_embedding_vec_index;
DROP TABLE IF EXISTS chunk_embeddings;
```

Drop old indexes (cascaded by `DROP TABLE`, but explicit for clarity):

```sql
DROP INDEX IF EXISTS idx_chunk_embeddings_note_path;
DROP INDEX IF EXISTS idx_chunk_embeddings_updated_at;
DROP INDEX IF EXISTS idx_chunk_embeddings_note_path_chunk_id;
DROP INDEX IF EXISTS idx_chunk_embeddings_note_title;
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created or modified in this story. The migration is consumed by the storage layer:

```
src/storage/vectorStoreSchema.ts (modified)
├── STOR-2: SqliteVecRepository executes these SQL statements
├── Existing: LocalVectorStoreRepository reads migration metadata only
└── Existing: bootstrapRuntimeServices.ts unchanged
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `VECTOR_STORE_MIGRATIONS` | `VectorStoreMigration[]` | N/A | Append new migration `003_hierarchical_model` |
| `VectorStoreMigration` | `{ id, description, statements }` | N/A | Existing type from `types.ts`; no changes needed |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — this story defines schema only |
| Error   | Not applicable |
| Empty   | Not applicable |
| Success | Not applicable |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/hierarchicalSchema.test.ts` | Tests verifying migration structure, statement validity, table/index coverage, and old table cleanup |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/storage/vectorStoreSchema.ts` | Append `003_hierarchical_model` migration with all CREATE TABLE, CREATE INDEX, CREATE VIRTUAL TABLE, and DROP TABLE/INDEX statements |

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — `VectorStoreMigration` type already exists and is sufficient
- `src/storage/LocalVectorStoreRepository.ts` — continues to use migration metadata for schema version tracking; no code changes needed
- `src/storage/vectorStorePaths.ts` — storage paths unchanged
- `src/bootstrap/bootstrapRuntimeServices.ts` — no service wiring changes
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/main.ts` — no command or lifecycle changes

---

## 5. Acceptance Criteria Checklist

### Phase A: Migration Structure

- [x] **A1** — Migration `003_hierarchical_model` exists in `VECTOR_STORE_MIGRATIONS` array
  - The migration has `id: "003_hierarchical_model"`, a descriptive `description`, and a non-empty `statements` array.
  - It is the third element (index 2) in the array, after `001_initial_chunk_embeddings` and `002_similarity_query_indexes`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::A1_migration_exists_at_index_2(vitest)`

- [x] **A2** — Migration contains valid SQL statements that can be parsed
  - Every statement in the `statements` array is a non-empty string ending with a semicolon.
  - No statement contains placeholder syntax (e.g., `{dimensions}`) — the embedding dimension is hardcoded to 1536 to match the existing `chunk_embedding_vec_index`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::A2_valid_sql_statements(vitest)`

### Phase B: Hierarchical Table Creation

- [x] **B1** — `nodes` table is created with all required columns
  - Columns: `node_id` (TEXT PK), `parent_id` (TEXT, FK to nodes), `note_path` (TEXT NOT NULL), `note_title` (TEXT NOT NULL), `heading_trail` (TEXT NOT NULL), `depth` (INTEGER NOT NULL), `node_type` (TEXT NOT NULL), `content` (TEXT NOT NULL), `sequence_index` (INTEGER NOT NULL DEFAULT 0), `content_hash` (TEXT NOT NULL), `updated_at` (INTEGER NOT NULL).
  - Foreign key: `parent_id REFERENCES nodes(node_id) ON DELETE CASCADE`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B1_nodes_table_created(vitest)`

- [x] **B2** — `node_children` table is created with composite primary key
  - Columns: `parent_id` (TEXT NOT NULL), `child_id` (TEXT NOT NULL), `sort_order` (INTEGER NOT NULL).
  - Primary key: `(parent_id, child_id)`.
  - Foreign keys to `nodes(node_id) ON DELETE CASCADE` for both columns.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B2_node_children_table_created(vitest)`

- [x] **B3** — `node_summaries` table is created with provenance columns
  - Columns: `node_id` (TEXT PK), `summary` (TEXT NOT NULL), `model_used` (TEXT NOT NULL), `prompt_version` (TEXT NOT NULL), `generated_at` (INTEGER NOT NULL).
  - Foreign key: `node_id REFERENCES nodes(node_id) ON DELETE CASCADE`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B3_node_summaries_table_created(vitest)`

- [x] **B4** — `node_embeddings` virtual table is created via sqlite-vec
  - Uses `vec0` virtual table module with `node_id TEXT PRIMARY KEY`, `embedding_type TEXT NOT NULL`, and `embedding FLOAT[1536]`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B4_node_embeddings_virtual_table_created(vitest)`

- [x] **B5** — `node_tags` table is created with composite primary key
  - Columns: `node_id` (TEXT NOT NULL), `tag` (TEXT NOT NULL).
  - Primary key: `(node_id, tag)`.
  - Foreign key: `node_id REFERENCES nodes(node_id) ON DELETE CASCADE`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B5_node_tags_table_created(vitest)`

- [x] **B6** — `node_cross_refs` table is created
  - Columns: `source_node_id` (TEXT NOT NULL), `target_path` (TEXT NOT NULL), `target_display` (TEXT, nullable).
  - Foreign key: `source_node_id REFERENCES nodes(node_id) ON DELETE CASCADE`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B6_node_cross_refs_table_created(vitest)`

- [x] **B7** — `metadata` table is created
  - Columns: `key` (TEXT PK), `value` (TEXT, nullable).
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::B7_metadata_table_created(vitest)`

### Phase C: Index Creation

- [x] **C1** — All required indexes are created
  - The migration includes CREATE INDEX statements for: `idx_nodes_parent_id`, `idx_nodes_note_path`, `idx_nodes_node_type`, `idx_nodes_content_hash`, `idx_node_children_parent`, `idx_node_tags_tag`, `idx_node_tags_node`, `idx_node_cross_refs_source`, `idx_node_cross_refs_target`, `idx_node_summaries_generated`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::C1_all_indexes_created(vitest)`

### Phase D: Old Table Cleanup

- [x] **D1** — Old `chunk_embeddings` table is dropped
  - The migration includes `DROP TABLE IF EXISTS chunk_embeddings`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::D1_old_chunk_embeddings_dropped(vitest)`

- [x] **D2** — Old `chunk_embedding_vec_index` virtual table is dropped
  - The migration includes `DROP TABLE IF EXISTS chunk_embedding_vec_index`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::D2_old_vec_index_dropped(vitest)`

- [x] **D3** — Old indexes from migrations 001 and 002 are dropped
  - The migration includes DROP INDEX statements for: `idx_chunk_embeddings_note_path`, `idx_chunk_embeddings_updated_at`, `idx_chunk_embeddings_note_path_chunk_id`, `idx_chunk_embeddings_note_title`.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::D3_old_indexes_dropped(vitest)`

### Phase E: Backward Compatibility

- [x] **E1** — Existing migrations 001 and 002 are unchanged
  - The first two elements of `VECTOR_STORE_MIGRATIONS` remain identical to their current values.
  - Evidence: `src/__tests__/unit/hierarchicalSchema.test.ts::E1_existing_migrations_unchanged(vitest)`

- [x] **E2** — `LocalVectorStoreRepository` continues to function with updated schema version
  - The repository's `getSchemaMetadata()` returns `schemaVersion: 3` and includes all three migration IDs.
  - All existing `localVectorStoreRepository.test.ts` tests continue to pass.
  - Evidence: `src/__tests__/unit/localVectorStoreRepository.test.ts::all_existing_tests_pass(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Embedding dimension hardcoded to 1536 may not match all models | 1536 matches the existing `chunk_embedding_vec_index` and OpenAI's `text-embedding-3-small` default. Future stories can add dimension configuration if needed. |
| 2 | DROP TABLE statements will destroy existing indexed data | This is by design — the hierarchical model is fundamentally different. A full reindex is required after migration. The README explicitly states this. |
| 3 | `LocalVectorStoreRepository` does not execute SQL, so migration validity cannot be fully verified in unit tests | SQL syntax is verified by string inspection in tests. Full execution testing happens in STOR-2 when `SqliteVecRepository` runs these statements against wa-SQLite. |
| 4 | sqlite-vec `vec0` virtual table syntax may differ across versions | The syntax matches the existing `chunk_embedding_vec_index` pattern already used in migration 001. |
| 5 | `node_embeddings` virtual table uses `IF NOT EXISTS` which may not be supported by all sqlite-vec versions | Matches existing pattern in migration 001; if unsupported, the statement will be adjusted in STOR-2 testing. |

---

## Implementation Order

1. `src/storage/vectorStoreSchema.ts` — Append `003_hierarchical_model` migration with CREATE TABLE statements for all 7 tables (covers B1–B7)
2. `src/storage/vectorStoreSchema.ts` — Add CREATE INDEX statements for all 10 indexes (covers C1)
3. `src/storage/vectorStoreSchema.ts` — Add DROP TABLE and DROP INDEX statements for old flat tables (covers D1–D3)
4. **Verify** — `npm run typecheck && npm run build` to confirm compilation (covers A1, A2)
5. `src/__tests__/unit/hierarchicalSchema.test.ts` — Write tests for migration structure, table/index coverage, old table cleanup, and backward compatibility (covers A1–E2)
6. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: STOR-1 | Epic: Epic 12 — SQLite Hierarchical Storage Migration*
