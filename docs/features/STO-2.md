# STO-2: sqlite-vec `vec0` virtual tables and `embedding_meta`

**Story**: Extend the sidecar database with **`vec_content` and `vec_summary`** sqlite-vec `vec0` virtual tables plus the **`embedding_meta`** relational table, where the **embedding dimension** used in `FLOAT[d]` DDL is taken from sidecar configuration (default **1536**, matching [Plugin Settings](../../README.md#plugin-settings) `embeddingDimension`) so vector storage stays aligned with the active embedding model.
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Medium
**Status**: Open

---

## 1. Summary

This story completes the README §8 **vector** slice: approximate nearest-neighbor storage co-located with relational node data ([README key technologies](../../README.md), [REQUIREMENTS §12](../requirements/REQUIREMENTS.md)). Native **sqlite-vec** loads in the **Node sidecar** alongside `better-sqlite3` ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)); the Obsidian plugin remains free of `sqlite-vec` ([FND-1](FND-1.md)).

**Explicit non-goal for MVP:** Supporting **in-place dimension changes** on an existing populated DB (mixed-dimensional vectors are invalid). If `embeddingDimension` differs from what the DB was created with, the Implementer must **fail fast with a clear error** or document a manual delete/reindex path — do not silently corrupt ANN indexes.

Depends on **STO-1** (relational tables + migration infrastructure + `nodes` FK targets for `embedding_meta`).

Pointers: README §8 (`vec_content`, `vec_summary`, `embedding_meta`); [src/core/domain/types.ts](../../src/core/domain/types.ts) (`VectorType`, `EmbedMeta`); [IDocumentStore](../../src/core/ports/IDocumentStore.ts) (future consumer in STO-3).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | sqlite-vec + better-sqlite3 run only in the sidecar; plugin ships no native vector stack. |
| [docs/decisions/ADR-004-per-vault-index-storage.md](../decisions/ADR-004-per-vault-index-storage.md) | Vector data lives in the same per-vault DB file as relational tables. |

**None additional** — vector technology choice is fixed by README + REQUIREMENTS + ADR-006; no new ADR required for configurable dimension within sqlite-vec.

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries _(README illustrates `FLOAT[1536]` as example; this story parameterizes `d` to match settings — default remains 1536)_
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk
- [ ] **Prerequisite:** [STO-1](STO-1.md) relational migrations and runner are merged (user_version baseline exists)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `vec_content` and `vec_summary` are created with `USING vec0(` … `embedding FLOAT[d]` … `)` where **d** equals the configured `embeddingDimension` at **first** vector migration time; persist **d** in migration metadata (e.g. `user_version` bump + stored pragma row or sidecar config table) for diagnostics.
2. **Y2** — `embedding_meta` matches README §8: composite PK `(node_id, vector_type)`, `vector_type IN ('content','summary')`, FK to `nodes(id)` ON DELETE CASCADE, columns `model`, `dimension`, `content_hash`, `created_at`.
3. **Y3** — Extension loading uses the **sqlite-vec** build intended for Node + better-sqlite3 (package / path per official sqlite-vec Node guidance); no WASM sqlite-vec in sidecar.
4. **Y4** — `src/plugin/**` and `src/core/**` must not import `sqlite-vec` or load the extension — vector DDL and loads live only under `src/sidecar/**`.
5. **Y5** — If opened DB already has vec tables and stored dimension ≠ current config dimension, open/migrate **fails** with an explicit error (no silent rebuild in this story).

---

## 5. API Endpoints + Schemas

No HTTP routes. Sidecar-internal API:

| Attribute | Value |
|-----------|-------|
| Surface | `loadVecExtension(db: Database): void` + `runVectorMigrations(db, { dimension: number }): void` |
| Auth | N/A |

```ts
/** Implementer aligns with better-sqlite3 Database type. */
export interface VectorMigrationOptions {
  /** Must match plugin/sidecar setting embeddingDimension (default 1536). */
  dimension: number;
}

export function ensureVectorSchema(db: unknown, options: VectorMigrationOptions): void;
```

No new types required in `shared/types.ts` if STO-3 reads/writes via `IDocumentStore` / `EmbedMeta` already in core.

---

## 6. Frontend Flow

Not applicable.

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
| 1 | `src/sidecar/db/migrations/002_vectors.sql` (or dynamic DDL in TS) | `vec_content`, `vec_summary`, `embedding_meta` with parameterized dimension. |
| 2 | `src/sidecar/db/load-sqlite-vec.ts` | Locate and `loadExtension` for sqlite-vec native binary in Node. |
| 3 | `src/sidecar/db/vector-migrate.test.ts` | Dimension correctness, extension load (skip in CI if no binary — document `vitest` `skip` policy). |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/sidecar/db/migrate.ts` | Chain STO-2 after STO-1; bump version; pass `dimension` from caller. |
| 2 | `package.json` | Add `sqlite-vec` dependency compatible with better-sqlite3 / Node 18+. |
| 3 | `esbuild.sidecar.mjs` | Keep `sqlite-vec` external where required for native resolution at runtime. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/**` — no sqlite-vec imports.
- `src/plugin/**` — no sqlite-vec imports ([scripts/check-source-boundaries.mjs](../../scripts/check-source-boundaries.mjs)).

---

## 8. Acceptance Criteria Checklist

### Phase A: Schema and dimension

- [ ] **A1** — After STO-1 + STO-2 migrations with `dimension = 1536`, both `vec_content` and `vec_summary` exist and accept inserts of 1536-dimensional vectors bound to `node_id` keys present in `nodes`.
  - Evidence: `src/sidecar/db/vector-migrate.test.ts::A1_vec_tables_roundtrip(vitest)` _(may be integration-only if extension load required)_

- [ ] **A2** — `embedding_meta` enforces PK `(node_id, vector_type)` and valid `vector_type` CHECK; FK cascade deletes when parent node removed.
  - Evidence: `src/sidecar/db/vector-migrate.test.ts::A2_embedding_meta_fk(vitest)`

- [ ] **A3** — Creating a new DB with `dimension = 768` (example alternate) produces vec DDL with `FLOAT[768]` (inspect generated SQL or pragma — exact introspection method documented in test comment).
  - Evidence: `src/sidecar/db/vector-migrate.test.ts::A3_dimension_parameterized(vitest)`

### Phase B: Misconfiguration guard

- [ ] **B1** — Opening a DB that was created with dimension D and passing dimension D′ ≠ D causes a **thrown** or **Result** error before any write (per section 4 Y5).
  - Evidence: `src/sidecar/db/vector-migrate.test.ts::B1_dimension_mismatch_fails(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** Root `package.json` lists `sqlite-vec` as a dependency; `src/plugin/**` has no `sqlite-vec` string in imports.
  - Evidence: `package.json lists "sqlite-vec"` + `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** Sidecar source loads sqlite-vec via `src/sidecar/**` only; `rg "sqlite-vec|loadExtension" src/core src/plugin` returns no matches (or only documented false positives).
  - Evidence: `src/sidecar/db/vector-migrate.test.ts::Y2_sidecar_only_load(vitest)` or CI grep step

- [ ] **Y3** — **(binding)** `npm run verify:plugin-bundle` passes.
  - Evidence: `scripts/verify-plugin-bundle.mjs(npm run verify:plugin-bundle)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A if unchanged; document N/A in PR
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | sqlite-vec native binary not available on some dev/CI hosts | Gate extension tests behind env flag; document local install; TST-2 covers full integration later. |
| 2 | Users switching embedding models with different dimensions | Fail fast (Y5); user docs (DOC-2) for delete DB / reindex. |

---

## Implementation Order

1. Merge dependency on [STO-1](STO-1.md) migration runner.
2. Add `sqlite-vec` package; implement `load-sqlite-vec.ts`.
3. Add migration 002 (vec + embedding_meta) with parameterized `d`.
4. Integrate into `migrate.ts` with version bump and dimension from config object (placeholder until SRV reads settings).
5. Write tests A1–A3, B1, Y2; run boundary + plugin bundle scripts.
6. **Final verify** — `npm run build`, `npm test`, `npm run check:boundaries`, `npm run verify:plugin-bundle`.

---

*Created: 2026-04-05 | Story: STO-2 | Epic: 3 — SQLite store, vectors, and indexing persistence*
