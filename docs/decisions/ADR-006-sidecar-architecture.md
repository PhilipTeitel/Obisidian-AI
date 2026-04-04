# ADR-006: Sidecar architecture with transport abstraction

## Status

Accepted (supersedes [ADR-001](./ADR-001-wasm-sqlite-vec-shipped-plugin.md))

## Context

Iteration 1 attempted to run wa-SQLite + sqlite-vec as WASM inside Obsidian's Electron renderer. This proved fragile: dynamic module loading conflicts, WASM asset pipeline hacks, and Electron version sensitivity created an unsustainable packaging burden. Meanwhile, iteration 2 requirements (queue-based orchestration, idempotent indexing with per-step tracking, service boundary abstraction) push beyond what the renderer can cleanly host.

The plugin model loads a single `main.js` in the renderer. It does not support dynamic imports, web workers with full filesystem access, or native addons cleanly.

## Decision

### 1. Sidecar process for heavy compute

All infrastructure-heavy work — SQLite (native `better-sqlite3` + `sqlite-vec`), embedding, summarization, queue management, and search — runs in a **local Node.js sidecar process** spawned by the plugin on load and terminated on unload.

### 2. Thin plugin client

The plugin `main.js` remains a **thin client** responsible for:

- UI rendering (SearchView, ChatView, ProgressSlideout)
- Obsidian API interactions (vault file reading, settings, secrets)
- Sidecar lifecycle management (spawn, health check, shutdown)
- Communication with the sidecar via a transport abstraction

The plugin ships **no native addons** — the constraint from ADR-001 is preserved for the plugin bundle itself.

### 3. Transport abstraction (`ISidecarTransport`)

Communication between plugin and sidecar is behind an `ISidecarTransport` port interface with two adapter implementations:

- **`StdioTransportAdapter` (default):** Communicates via the spawned child process's stdin/stdout using a newline-delimited JSON protocol. Low latency, no TCP overhead, inherently private to the parent/child process pair (no auth token needed).
- **`HttpTransportAdapter` (opt-in):** Communicates via HTTP REST + WebSocket. Sidecar binds to `127.0.0.1` with a random port. A per-session auth token (generated at spawn) is required in the `Authorization` header on all requests. Useful for development/debugging (curl-accessible) and future remote-sidecar scenarios.

The sidecar's API contract (message shapes, route semantics) is identical regardless of transport — only the framing layer differs.

### 4. Vault access stays in the plugin

The plugin reads vault files via the Obsidian API and sends content to the sidecar for processing. The sidecar does **not** access the vault filesystem directly. This keeps the sidecar a stateless compute engine with no coupling to vault paths or the Obsidian runtime.

### 5. Secrets stay in the plugin

API keys are read from Obsidian's SecretStorage and passed to the sidecar per-request (in the message payload). The sidecar never persists or caches secrets.

### 6. Node.js as a runtime prerequisite

Iteration 2 requires **Node.js >= 18** on the user's machine to run the sidecar. Future iterations may compile the sidecar to a single executable (via `pkg`, Node.js SEA, or similar) to remove this prerequisite.

## Consequences

- **Positive:** Native SQLite eliminates WASM fragility; heavy compute is off the renderer thread; plugin bundle stays small; domain logic is testable in isolation without Obsidian mocks; transport abstraction enables future deployment flexibility.
- **Negative:** Node.js becomes a user prerequisite; an extra process to manage (spawn, health check, crash recovery); IPC adds serialization overhead compared to in-process calls.
- **Migration:** This is a green-field iteration; no data or code migration from the `force-wasm` branch.

## Alternatives considered

- **Continue WASM-in-renderer (ADR-001):** Rejected — proven fragile in iteration 1; increasingly constrained by new requirements.
- **Obsidian embedded Node via `child_process`:** Obsidian's Electron does not expose Node.js to plugins in the renderer; spawning a child process requires the user to have Node.js installed separately.
- **Compiled binary sidecar (pkg/SEA):** Viable future optimization but adds cross-platform build complexity; deferred to a later iteration.
- **WebAssembly with SharedArrayBuffer workers:** Would partially address the renderer constraint but does not solve queue persistence, crash recovery, or the sqlite-vec WASM packaging issues.

## References

- [ADR-001](./ADR-001-wasm-sqlite-vec-shipped-plugin.md) (superseded)
- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §12, §13
- Iteration 2 plan: `.cursor/plans/obsidian_ai_iteration_2_95fe6b8a.plan.md`
