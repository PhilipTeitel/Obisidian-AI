REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: STO-4 — FTS5 index, `note_date`, and `prompt_version` schema migration (002)

**Reviewed against:** `docs/features/STO-4.md`
**Date:** 2026-04-20
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: STO-4
- Linked refined requirements (Sn IDs in scope): REQ-004 S1, S4, S7, S8, S9; REQ-005 S5, S6, S7, S9 (per §8a coverage rows)
- Files in scope (from Section 7 "Files to CREATE/MODIFY" intersected with working-tree changes for this story):
  - `src/sidecar/db/migrations/002_fts.sql` — created
  - `tests/sidecar/db/migrations.002.test.ts` — created
  - `tests/sidecar/db/migrations.002.rebuild.test.ts` — created
  - `tests/contract/document-store.contract.ts` — created
  - `tests/integration/sqlite-document-store.migration-002.test.ts` — created
  - `src/sidecar/db/migrate.ts` — modified
  - `src/sidecar/adapters/SqliteDocumentStore.ts` — modified
  - `docs/guides/user-storage-and-uninstall.md` — modified
  - `README.md` — modified
- Tests in scope (from Section 8a Test Plan):
  - `tests/sidecar/db/migrations.002.test.ts` — A1, A2, B1, B2, D1–D3, Z5
  - `tests/sidecar/db/migrations.002.rebuild.test.ts` — C1, C2
  - `tests/contract/document-store.contract.ts` — `contract_round_trip`
  - `tests/integration/sqlite-document-store.migration-002.test.ts` — Y1–Y8
  - `scripts/verify-stack.mjs` via `npm run verify:stack` — Y3, Z3, Z4
- Adapters in scope (from Section 4b):
  - `SqliteDocumentStore` for port `IDocumentStore`

### Out-of-plan changes

- `vitest.config.ts` — adds `tests/contract/document-store.contract.ts` to `include` so Vitest discovers the contract file (filename is not `*.test.ts`). Recommend adding this path to Section 7 on the next doc pass.
- `package.json` — adds `verify:stack` script required by story §Implementation Order step 9; recommend listing under Section 7 MODIFY.
- `tests/sidecar/db/migrate.test.ts` — updates expected tables/indexes because `runRelationalMigrations` now applies STO-4 as well; reasonable collateral.

---

## Findings

### Test Coverage (`TEST-#`)

None.

### Reliability (`REL-#`)

None.

### Security (`SEC-#`)

None.

### API Contracts (`API-#`)

None.

---

## Required actions before QA

(None — gate `Pass`.)

---

## Notes

- Rebuild gating uses `nodes_fts_docsize` row count instead of `COUNT(*)` on the external-content `nodes_fts` virtual table, because SQLite reports non-zero row counts on that virtual table before the full-text index is actually populated; behavior matches STO-4 intent and is documented in `migrate.ts` and `docs/guides/user-storage-and-uninstall.md`.
