# VEC-2: Lazy DB lifecycle — open/create, dispose, sqlite-vec load

**Story**: Introduce a **database access layer** that opens (or creates) the per-vault `.sqlite3` file on **first use** of hierarchical storage, ensures parent directory `.obsidian-ai` exists, loads **sqlite-vec**, and **closes** on service dispose. Align with REL-1 lazy initialization (prompt 05 §3).
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: Medium
**Status**: Not Started

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) — §3 lazy init, §2.1 create directory, §1.6 one DB per vault
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 2

---

## 1. Summary

Prompt 05 §3: **no heavy DB work at plugin load**; open migrations + sqlite-vec on **first operation** that needs the hierarchical store.

VEC-2 is the **first story that must run inside Obsidian desktop**: the database layer uses **WASM SQLite + sqlite-vec** in the renderer only. The **shipped plugin** must remain **free of native Node addons** (`*.node`, bundled `.dylib`/`.so`/`.dll` in the release layout). Node-only proof from VEC-0 does not substitute for this validation ([ADR-001](../decisions/ADR-001-sqlite-vec-stack.md)).

VEC-2 delivers:

- A small module (suggested: `src/storage/sqlite/…`) owning connection lifecycle.
- **Lazy open**: first call that needs the DB triggers create-parent-dir, open file, load **sqlite-vec via the WASM stack** (not better-sqlite3 / npm `sqlite-vec` native).
- **`dispose()`**: close connection, clear singleton/state so plugin unload does not leak.
- **Path input**: absolute path from **VEC-1** `resolveVectorStoreDatabasePath` (passed into repository or factory at runtime).

VEC-2 **may** run migrations inline or delegate to VEC-3; if split, VEC-2 exposes `getConnection()` only after VEC-3 registers a post-open hook. Prefer: VEC-2 opens raw; VEC-3 runs migrations on same connection **first** — document ordering in bootstrap.

---

## 2. API Endpoints + Schemas

Internal TypeScript API only. Illustrative:

```ts
export interface SqliteDatabaseHandle {
  // Opaque or thin wrapper around wa-sqlite / driver
  close(): Promise<void> | void;
}

export interface OpenVectorStoreDatabaseOptions {
  absoluteDbPath: string;
  logger: RuntimeLogger; // or project logger type
}

export async function openVectorStoreDatabaseLazy(
  options: OpenVectorStoreDatabaseOptions
): Promise<SqliteDatabaseHandle>;
```

Exact shape follows the **WASM** integration chosen for Obsidian (VEC-0 validated SQL semantics under Node only).

---

## 3. Frontend Flow

No new panes. Optional: settings “Test path” button is **out of scope** unless product asks.

---

## 4. File Touchpoints

### Files to CREATE (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/sqlite/openVectorStoreDatabase.ts` (or similar) | Lazy open, mkdir, extension load |
| 2 | Tests under `src/__tests__/unit/` or integration harness | As feasible for WASM |

### Files to MODIFY (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/SqliteVecRepository.ts` (or successor) | Trigger lazy open on first contract method |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Pass vault + settings into repository deps for path resolution |
| 3 | `RuntimeServiceLifecycle` usage | `dispose()` closes DB |

---

## 5. Acceptance Criteria Checklist

### Phase A: Lazy open

- [ ] **A1** — No file open or WASM sqlite init during `bootstrapRuntimeServices` **before** first hierarchical store operation (verify via log or test spy)
- [ ] **A2** — First hierarchical store operation triggers directory create for default parent when using default path (`.obsidian-ai`)
- [ ] **A3** — Opening uses **absolute** path from VEC-1 resolver only

### Phase B: sqlite-vec (WASM)

- [ ] **B1** — sqlite-vec is loaded through the **WASM** SQLite build (not Node `sqlite-vec` / better-sqlite3) before any `vec0` DDL runs (VEC-3 may run DDL; order documented)
- [ ] **B2** — Failure to load extension surfaces normalized error with user-actionable message

### Phase C: Lifecycle

- [ ] **C1** — `dispose()` on hierarchical store closes DB and subsequent operations fail fast or no-op per project convention
- [ ] **C2** — Re-opening after dispose in same session behaves as documented (usually: plugin reload only)

### Phase Z: Quality gates

- [ ] **Z1** — `npm run typecheck && npm run build && npm run test && npm run lint`

### Phase D: In-Obsidian validation and shippable artifact

- [ ] **D1** — **Manual smoke:** Install the built plugin in **Obsidian desktop** (minimum app version per manifest); confirm lazy open, sqlite-vec load, and at least one DB touch path without console errors related to WASM or CSP
- [ ] **D2** — **Community-style install:** Document or verify that the release folder (e.g. `main.js` + `manifest.json` + styles + any `.wasm`/worker assets **you intend to ship**) works when copied into `.obsidian/plugins/<id>/` **without** running `npm install` or shipping `node_modules`
- [ ] **D3** — **`npm run build`** passes **`check:shipped-native`**; release instructions state that shipped zips must not add native binaries beside the plugin (only WASM + JS + static assets)

---

## 6. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Race on first concurrent calls | Serialize open with a promise mutex inside lazy opener. |
| 2 | Vault switch in one window | Document Obsidian model; close DB when runtime torn down. |

---

## 7. Dependencies

- **Blocked by**: VEC-0 (stack), VEC-1 (path)
- **Blocks**: VEC-3 (migrations need connection), VEC-4 (repository needs connection)

---

## 8. Implementation Order

1. Implement lazy opener module with mutex
2. Wire `SqliteVecRepository` to call opener on first use (stub methods OK until VEC-4)
3. Wire `dispose()` to close
4. Add logging events: `storage.sqlite.open.started/completed`, `storage.sqlite.dispose`
5. Tests: mock FS / driver where WASM not in CI; **Phase D** manual smoke in Obsidian is required for acceptance

---

*Story: VEC-2 | Epic 19 | Prompt 05 §3 + plan Phase 2*
