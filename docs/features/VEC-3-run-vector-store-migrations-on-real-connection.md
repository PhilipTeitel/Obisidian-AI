# VEC-3: Run `VECTOR_STORE_MIGRATIONS` on a real connection

**Story**: Execute every statement in [VECTOR_STORE_MIGRATIONS](../../src/storage/vectorStoreSchema.ts) **in order** against the opened SQLite connection, and record applied migration IDs in the **`metadata`** table so startup is **idempotent**.
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: Medium
**Status**: Not Started

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) — §4.1 migrations and metadata tracking
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 3

---

## 1. Summary

Today, migrations exist as **strings only**; nothing runs them in the app. VEC-3 implements a **migration runner** invoked immediately after lazy DB open (VEC-2) and **sqlite-vec** load (VEC-0/2 ordering).

Behavior:

1. Read applied migration IDs from `metadata` (convention: e.g. key `applied_migration_id` per row or single JSON blob — **choose one** and document; must support ordered list matching `VectorStoreMigration.id`).
2. For each migration in `VECTOR_STORE_MIGRATIONS` whose `id` is not applied, run `statements` **sequentially** inside transactions where SQLite allows (split if a statement cannot run in the same transaction as vec DDL per engine limits).
3. Mark migration applied **only** after all its statements succeed.
4. Emit structured logs: migration start, per-id complete, failure with statement index.

**Note:** Migration `003_hierarchical_model` **drops** legacy chunk tables. On a **fresh** profile DB this is fine. On first release of file-backed store, typical user has **no** prior file — document **full reindex** (prompt 05 §5).

---

## 2. API Endpoints + Schemas

Internal API only. Illustrative:

```ts
import type { VectorStoreMigration } from "../types";

export async function runVectorStoreMigrations(
  db: SqliteDb, // driver-specific type from VEC-0
  migrations: VectorStoreMigration[]
): Promise<void>;
```

---

## 3. Frontend Flow

N/A. Optional: progress notice during long migration — out of scope unless trivial.

---

## 4. File Touchpoints

### Files to CREATE (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/sqlite/runVectorStoreMigrations.ts` | Runner + metadata persistence |
| 2 | `src/__tests__/unit/runVectorStoreMigrations.test.ts` | Idempotency + order (driver permitting) |

### Files to MODIFY (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/sqlite/openVectorStoreDatabase.ts` or `SqliteVecRepository` | Invoke runner after open |
| 2 | `src/storage/vectorStoreSchema.ts` | Only if DDL must be adjusted for chosen sqlite-vec build (minimize churn) |

---

## 5. Acceptance Criteria Checklist

### Phase A: Correctness

- [ ] **A1** — Fresh empty DB: all migrations `001` → `003` apply successfully including `vec0` statements
- [ ] **A2** — Second open: **no** duplicate errors; runner detects already-applied IDs and skips
- [ ] **A3** — Applied IDs in `metadata` match `VECTOR_STORE_MIGRATIONS[].id` after successful run

### Phase B: Failure handling

- [ ] **B1** — Mid-migration failure leaves DB consistent (transaction rollback per migration batch) or documents partial state + user action (prefer rollback)
- [ ] **B2** — Logs include `migrationId` and failing `statementIndex` / SQL snippet (truncate for size)

### Phase C: Alignment with types

- [ ] **C1** — Runner imports migrations from single source of truth: `VECTOR_STORE_MIGRATIONS` export

### Phase Z: Quality gates

- [ ] **Z1** — `npm run typecheck && npm run build && npm run test && npm run lint`

---

## 6. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `vec0` + transaction boundaries | Follow sqlite-vec docs; split transactions if required. |
| 2 | CI cannot run WASM | Use conditional tests + manual checklist reference. |

---

## 7. Dependencies

- **Blocked by**: VEC-0, VEC-2
- **Blocks**: VEC-4 (repository assumes tables exist)

---

## 8. Implementation Order

1. Define metadata schema for applied migration IDs (minimal SQL)
2. Implement `getAppliedMigrationIds` / `recordMigrationApplied`
3. Implement ordered runner with transactions
4. Hook into lazy open path immediately after extension load
5. Tests: temp file DB, two opens, assert idempotency

---

*Story: VEC-3 | Epic 19 | Prompt 05 §4.1 + plan Phase 3*
