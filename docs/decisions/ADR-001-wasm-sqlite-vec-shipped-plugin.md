# ADR-001: WASM SQLite + sqlite-vec for the shipped Obsidian plugin

## Status

**Superseded** by [ADR-006](./ADR-006-sidecar-architecture.md)

## Context

The plugin runs inside **Obsidian desktop** (Electron/Chromium renderer). The product requires **local** persistence of a **hierarchical index** with **approximate nearest-neighbor** vector search (sqlite-vec / `vec0`-class capabilities).

Community-distributed plugins must install cleanly from a **single bundled artifact** without compiling native code on the end user's machine. The runtime is **not** Node.js; it is the **browser/Electron renderer** with a constrained loading model for native modules.

## Decision

1. **Production runtime:** Use **WASM-based SQLite** with the **sqlite-vec** extension loaded in a way that works in the **renderer** (no Node native addons in the shipped bundle). Vector search uses sqlite-vec's virtual table / KNN patterns rather than application-level full scans over all rows at scale.

2. **Native addons are forbidden in the shipped plugin:** The distributed artifact (e.g. `main.js`, workers, bundled `.wasm`, CSS) must **not** depend on `*.node` binaries, `.dylib`, `.so`, `.dll`, or other **platform-specific native modules** loaded by the plugin at runtime. The plugin must **not** require users to have a **platform-specific `node_modules` tree** with optional native builds after a normal install.

3. **Development and tooling:** Maintainers **may** use **Node-only** stacks (e.g. better-sqlite3 + sqlite-vec native packages) for **scripts**, **spikes**, **CI**, and **local inspection** tools, provided those dependencies are **not** bundled into the Obsidian plugin entrypoint.

4. **Exact npm package names, worker wiring, and bundler asset pipeline** for the WASM build are **implementation choices** revisited during implementation, as long as the behavioral requirements (local DB, vec search, renderer compatibility) are met.

## Why Superseded

Iteration 1 (the `force-wasm` branch) validated that loading wa-SQLite + sqlite-vec as WASM in Obsidian's Electron renderer is **fragile and unsustainable**:

- Custom WASM asset copying scripts and `Float32Array` → `Uint8Array` blob workarounds were required.
- Electron's restrictions on dynamic module loading conflicted with WASM loading patterns.
- esbuild externalization of Node built-ins (`crypto`, `fs`, `os`, `path`, `url`) clashed with Obsidian's plugin loader.
- The approach broke across Electron versions and required constant maintenance.

**ADR-006** replaces this with a **sidecar architecture** where native `better-sqlite3` + `sqlite-vec` runs in a separate Node.js process. The plugin `main.js` remains a thin client with **no native addons** — the constraint that "the plugin ships no native modules" is preserved, but heavy infrastructure moves to the sidecar.

## Consequences

- **Positive:** Aligns with how Obsidian plugins are distributed; avoids native ABI fragility across Electron versions and user OSes.
- **Negative:** WASM + extension loading is more involved than Node native sqlite; debugging and packaging require discipline.
- **Enforcement:** Build/lint policy should prevent accidental inclusion of native modules in the shipped bundle (project-specific checks as needed).

## Alternatives considered

- **Node native sqlite-vec in the plugin:** Rejected for production — conflicts with renderer packaging and end-user install expectations.
- **sql.js without sqlite-vec:** Does not satisfy sqlite-vec / vec0 vector search requirements without non-trivial additional glue.
- **Remote vector database:** Rejected for core MVP privacy/locality requirements.

## References

- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- Product requirements: [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md)
- Superseded by: [ADR-006-sidecar-architecture.md](./ADR-006-sidecar-architecture.md)
