# VEC-0: Spike — wa-SQLite + sqlite-vec in Obsidian/Electron bundle

**Story**: Prove that a chosen **wa-SQLite + sqlite-vec** stack can be bundled with the plugin build, load the sqlite-vec extension, and execute `vec0` DDL plus a minimal vector query against a database file at an **absolute path outside the vault**.
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: Medium
**Status**: Done

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) (§1 goals, §4.4 vector search, §10 non-goals: package choice deferred here)
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 0

---

## 1. Summary

Epic 19 is blocked on a **technical decision**: which WASM/native SQLite + sqlite-vec integration works inside Obsidian’s Electron renderer (or agreed host context), bundles cleanly with **esbuild**, and supports **file-backed** databases at user-controlled absolute paths (see prompt 05 §2–3).

This spike produces a **short decision record** (ADR or `docs/` note) and a **minimal proof** (script or tiny in-repo harness): open DB → create virtual table compatible with migration 003’s `node_embeddings` shape → insert one row → run one sqlite-vec **KNN** (or documented ANN) query → close.

No production wiring into `SqliteVecRepository` is required in VEC-0; that is VEC-2–VEC-4.

**Outcome:** [ADR-001](../decisions/ADR-001-sqlite-vec-stack.md) records **better-sqlite3 + sqlite-vec** for Node proof/tooling; **Obsidian WASM integration deferred to VEC-2**. Proof: `npm run spike:vec0` → [`scripts/vec0-spike.mjs`](../../scripts/vec0-spike.mjs).

---

## 2. API Endpoints + Schemas

N/A — internal R&D and build validation.

---

## 3. Deliverables

| Deliverable | Description |
|-------------|-------------|
| **Decision record** | Selected packages/repos, rationale, Obsidian version assumptions, desktop OS matrix (macOS / Windows / Linux). |
| **Build notes** | esbuild `external` / asset copy / WASM loading steps that downstream stories must follow. |
| **Proof artifact** | Runnable minimal example (may live under `scripts/` or a dev-only entry) demonstrating vec0 + query on disk **outside** a vault path. |
| **Explicit non-decisions** | What was rejected and why (one paragraph). |

---

## 4. File Touchpoints

### Files to CREATE (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/decisions/ADR-XXX-sqlite-vec-stack.md` (or equivalent) | Spike outcome and chosen stack |
| 2 | Minimal proof script or harness | As decided in spike |

### Files to MODIFY (possible)

| # | Path | Purpose |
|---|------|---------|
| 1 | `package.json` | Dev/runtime deps chosen by spike |
| 2 | `esbuild.config.mjs` | Bundle WASM/assets per spike outcome |

Exact paths are intentionally flexible until the spike completes.

**Created:** `docs/decisions/ADR-001-sqlite-vec-stack.md`, `scripts/vec0-spike.mjs`. **Modified:** `package.json` (devDependencies + `spike:vec0` script). **esbuild:** unchanged — ADR states browser bundle must not pull Node native deps; VEC-2 adds WASM path.

---

## 5. Acceptance Criteria Checklist

### Phase A: Decision and documentation

- [x] **A1** — Written decision record links to prompt 05 and implementation plan Phase 0
- [x] **A2** — Document lists minimum Obsidian/Electron versions validated (or “not yet validated” with follow-up)
- [x] **A3** — Document states mobile scope: **out of scope** for MVP per prompt 05 §10 unless explicitly expanded

### Phase B: Technical proof

- [x] **B1** — Proof opens/creates a `.sqlite3` file at a **non-vault** absolute path
- [x] **B2** — Proof loads **sqlite-vec** and creates a `vec0` table compatible with hierarchical `node_embeddings` intent (node id, embedding type, float vector of fixed dimension matching [vectorStoreSchema.ts](../../src/storage/vectorStoreSchema.ts) or documented deviation)
- [x] **B3** — Proof runs at least one **vector search** API supported by sqlite-vec (KNN / ANN as per extension docs), not pure JS cosine over the full table
- [x] **B4** — Proof closes DB cleanly (no handle leak in long-running dev scenario)

### Phase Z: Quality gates

- [x] **Z1** — `npm run build` still passes after any spike deps/config land (or spike is isolated branch with documented merge steps)
- [x] **Z2** — No production user-facing behavior change required for spike-only merge (optional: spike lives on branch until VEC-1)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | WASM sqlite-vec fails in Obsidian sandbox | Validate early in desktop build; document blockers. |
| 2 | esbuild cannot embed WASM without extra steps | Capture exact pattern in ADR for VEC-2. |
| 3 | Spike drifts into full VEC-4 | Time-box; stop at B3 proof. |

---

## 7. Dependencies

- **Blocks**: VEC-2, VEC-3, VEC-4 (engine + migrations + repository)
- **Parallel**: VEC-1 may proceed using mocked paths if no hard dependency on WASM API shape

---

## 8. Implementation Order

1. Research shortlist (2–3 options) against Obsidian + esbuild constraints
2. Build smallest vertical slice for winner
3. Write ADR + proof commands in README or story footer
4. Hand off to VEC-2 owner with copy-paste build snippet

**Verify locally:** `npm run spike:vec0` (requires devDependencies install including platform `sqlite-vec-*` optional package). `npm run build && npm run test`.

---

*Story: VEC-0 | Epic 19 | Prompt 05 + sqlite-vector-store-implementation-plan Phase 0*
