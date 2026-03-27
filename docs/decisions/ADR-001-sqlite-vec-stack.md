# ADR-001: sqlite-vec stack for Epic 19 (VEC-0 spike)

## Status

Accepted (spike complete — 2026-03-24)

## Context

[docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) requires a real SQLite database with **sqlite-vec** (`vec0`) for hierarchical embeddings, file paths **outside the vault**, and lazy init in the plugin ([implementation plan Phase 0](../plans/sqlite-vector-store-implementation.md)).

Obsidian plugins are bundled with **esbuild** as **`platform: "browser"`** ([esbuild.config.mjs](../../esbuild.config.mjs)); runtime is Electron/Chromium, not Node.

## Product constraint (shipped plugin)

The **distributed Obsidian plugin** (everything Obsidian loads: `main.js`, any chunks, workers, `.wasm`, CSS) must:

- **Not** ship, load, or depend on **`*.node`** or any other **native addon** (`.so`, `.dylib`, `.dll`, etc.).
- **Not** require end users to have **platform-specific `node_modules` trees** (optional native deps, postinstall compiles, etc.) for the plugin to run after a normal Community Plugins install.

**WASM** (wa-SQLite + sqlite-vec in the Electron renderer) is the **only** permitted in-process SQLite + vector extension stack for **production plugin runtime**.

**Exception:** Code under **`scripts/`** (and any future **Node-only** CLIs or packages not bundled into `main.js`) **may** use **better-sqlite3**, **sqlite-vec** platform packages, and other native tooling for development, spikes, migrations rehearsal, and CI.

## Decision

1. **Proof / tooling (Node):** Use **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** + **[sqlite-vec](https://www.npmjs.com/package/sqlite-vec)** (`sqliteVec.load(db)`), with platform-specific loadable libraries pulled via npm `optionalDependencies` (`sqlite-vec-darwin-arm64`, etc.). This stack is used for **VEC-0 proof**, **developer scripts** (e.g. [`scripts/vec0-spike.mjs`](../../scripts/vec0-spike.mjs)), and future **`query-store`-style** tooling that must load sqlite-vec (prompt 05 §7.1 Option 1).

2. **Production plugin runtime (Obsidian):** **Not implemented in VEC-0.** The next step (**VEC-2**) is to integrate a **WASM SQLite** build that supports **sqlite-vec in the browser/Electron renderer** (same upstream project documents WASM support). The exact package and esbuild asset pipeline will follow the same upstream (`asg017/sqlite-vec`) guidance used in Node.

3. **Schema alignment:** The spike uses the same `vec0` column layout as migration `003` in [`src/storage/vectorStoreSchema.ts`](../../src/storage/vectorStoreSchema.ts): `node_id TEXT PRIMARY KEY`, `embedding_type TEXT NOT NULL`, `embedding FLOAT[1536]`. KNN queries use the sqlite-vec `WHERE embedding MATCH ? AND k = ?` pattern (not application-level full-scan cosine).

## Obsidian / Electron validation

**Not yet validated in-app** in VEC-0. Spike runs under **Node.js** only. Follow-up: load test build inside Obsidian desktop (minimum version TBD) when VEC-2 lands.

## Mobile scope

**Out of scope** for MVP per prompt 05 §10 unless explicitly expanded.

## Build notes for downstream stories (VEC-2+)

| Topic | Guidance |
|-------|-----------|
| **Main plugin bundle** | Keep `esbuild` entry as today; **do not** mark `better-sqlite3` or `sqlite-vec` as non-external for `main.js` — they are **Node-only** and must not be pulled into the browser bundle. ESLint **`no-restricted-imports`** on `src/**/*.ts` and **`npm run check:shipped-native`** after build enforce this. |
| **WASM / assets** | VEC-2 will add a **separate** mechanism: copy `.wasm` + worker glue from the chosen wa-sqlite/sqlite-vec release, or use a documented CDN-less bundle path; configure esbuild `loader` / `publicPath` / `assetNames` as required by the chosen package. |
| **optionalDependencies** | `sqlite-vec` platform packages must remain installable on maintainer/CI machines **for scripts/CI only**; they are **not** part of the shipped plugin artifact. Document OS matrix (darwin/linux arm64/x64, windows x64). |

## Alternatives considered

**wa-sqlite-only spike in VEC-0:** Higher integration cost for a time-boxed story; deferred to VEC-2. The Node proof still validates **sqlite-vec semantics**, SQL shape, and extension versioning.

**sql.js:** SQLite compiled to JS/WASM without loading **sqlite-vec** as an extension does **not** satisfy vec0 / KNN requirements without extra glue.

**Raw `sqlite3` CLI subprocess:** Possible for scripts only; worse DX for in-process IndexingService and does not help the Obsidian renderer path.

## References

- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [Using sqlite-vec in Node.js](https://alexgarcia.xyz/sqlite-vec/js.html)
- [05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md)
- [sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) Phase 0
