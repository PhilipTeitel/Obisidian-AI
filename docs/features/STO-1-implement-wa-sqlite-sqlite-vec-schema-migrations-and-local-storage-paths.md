# STO-1: Implement wa-SQLite/sqlite-vec schema, migrations, and local storage paths

**Story**: Define the local vector-store schema and migration metadata for wa-SQLite/sqlite-vec, and standardize plugin-local storage paths where index data is persisted.
**Epic**: Epic 3 — Local Vector Storage and Embedding Providers
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story establishes the storage foundation for semantic indexing by defining a durable schema contract and local-path strategy for vector data. It introduces migration metadata that captures the expected wa-SQLite/sqlite-vec shape even before native SQLite wiring is finalized.

The key requirement is locality: all indexed data must remain inside the plugin directory under `.obsidian/plugins/<plugin-id>/...`. This keeps user content local-first and avoids external persistence dependencies.

This story intentionally focuses on schema + migration contracts and storage-path guarantees. It does not yet implement full retrieval/query business behavior (that is covered in STO-2).

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required for STO-1.

Type additions are internal plugin domain contracts in `src/types.ts` (not `shared/types.ts`) and should include:

```ts
export interface LocalVectorStorePaths {
  rootDir: string;
  sqliteDbPath: string;
  migrationsDir: string;
}

export interface VectorStoreMigration {
  id: string;
  description: string;
  statements: string[];
}

export interface VectorStoreSchemaMetadata {
  schemaVersion: number;
  appliedMigrationIds: string[];
  paths: LocalVectorStorePaths;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
bootstrapRuntimeServices
└── LocalVectorStoreRepository
    ├── resolveLocalVectorStorePaths(pluginId)
    └── VECTOR_STORE_MIGRATIONS (wa-SQLite/sqlite-vec SQL metadata)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `resolveLocalVectorStorePaths` | `(pluginId: string) => LocalVectorStorePaths` | Stateless/pure | Produces deterministic plugin-local storage paths |
| `VECTOR_STORE_MIGRATIONS` | `VectorStoreMigration[]` | Static | Declares schema and index migration SQL statements |
| `VectorStoreSchemaMetadata` | persisted metadata shape | N/A | Captures schema version + applied migration IDs |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable; backend/runtime-only storage planning |
| Error   | Invalid persisted schema metadata falls back to baseline metadata |
| Empty   | No prior vector-store state creates baseline schema metadata |
| Success | Repository exposes valid schema metadata and plugin-local paths |

No frontend component changes are required.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/vectorStorePaths.ts` | Resolve deterministic plugin-local storage paths |
| 2 | `src/storage/vectorStoreSchema.ts` | Define wa-SQLite/sqlite-vec migration metadata and SQL statements |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add storage path + migration + schema metadata interfaces |
| 2 | `src/storage/LocalVectorStoreRepository.ts` | Initialize persisted schema metadata and applied migration IDs |
| 3 | `src/bootstrap/bootstrapRuntimeServices.ts` | Wire plugin ID/path metadata into repository construction |

### Files UNCHANGED (confirm no modifications needed)

- `src/main.ts` — command registration and UI lifecycle are unaffected
- `src/ui/SearchView.ts` — UI behavior is out of scope for storage schema groundwork
- `src/ui/ChatView.ts` — chat UX does not change in STO-1

---

## 5. Acceptance Criteria Checklist

### Phase A: Path and Schema Contracts

- [x] **A1** — Plugin-local vector storage paths are deterministic
  - Path resolver returns storage locations under `.obsidian/plugins/<plugin-id>/...`.
  - Path computation never depends on remote services or user home directories.

- [x] **A2** — wa-SQLite/sqlite-vec migration metadata exists
  - At least one migration declares base tables plus sqlite-vec virtual table statements.
  - Migration IDs are stable and ordered for repeatable schema versioning.

### Phase B: Persisted Schema Metadata

- [x] **B1** — Repository persists schema version and applied migration IDs
  - Fresh state initializes schema metadata to latest known version.
  - Re-loading existing state preserves metadata without mutation drift.

- [x] **B2** — Invalid schema metadata safely recovers to baseline
  - Malformed metadata does not crash runtime initialization.
  - Baseline metadata is reconstructed using current migration definitions.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | SQL metadata may drift from eventual wa-SQLite runtime behavior | Keep migrations explicit, versioned, and covered by unit tests |
| 2 | Plugin ID may be unavailable in some test contexts | Provide deterministic fallback plugin ID for path resolution |
| 3 | Baseline recovery can hide malformed state silently | Add tests asserting fallback behavior and preserved schema invariants |

---

## Implementation Order

1. `src/types.ts` — add local path, migration, and schema metadata contracts (covers A1, A2, B1).
2. `src/storage/vectorStorePaths.ts` — implement deterministic plugin-local path resolver (covers A1).
3. `src/storage/vectorStoreSchema.ts` — define ordered wa-SQLite/sqlite-vec migrations (covers A2).
4. `src/storage/LocalVectorStoreRepository.ts` — initialize and persist schema metadata with fallback recovery (covers B1, B2).
5. `src/bootstrap/bootstrapRuntimeServices.ts` — wire plugin ID/path resolution into runtime setup (covers A1, B1).
6. **Verify** — run unit tests for repository/path/migration behavior (covers B2, Z2, Z3).
7. **Final verify** — run `npm run build` to validate end-to-end typing and bundling (covers Z1, Z4).

---

*Created: 2026-02-23 | Story: STO-1 | Epic: Epic 3 — Local Vector Storage and Embedding Providers*
