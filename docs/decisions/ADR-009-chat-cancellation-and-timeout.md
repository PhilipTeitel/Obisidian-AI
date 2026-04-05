# ADR-009: Chat completion cancellation and timeout

**Status:** Accepted  
**Date:** 2026-04-05

---

## Context

[REQUIREMENTS §6](../requirements/REQUIREMENTS.md) requires a **configurable chat timeout** (default 30s). Users also need to **cancel** an in-flight streamed completion from the UI (REQUIREMENTS §10 — send/cancel affordances). [ADR-005](ADR-005-provider-abstraction.md) commits to pluggable chat providers but does not spell out how **abort** and **timeout** cross the `IChatPort` boundary or the plugin ↔ sidecar transport.

Without an explicit contract, implementers may bake timeouts only into one adapter, omit cancellation on stdio, or leak partial streams after abort.

---

## Decision

1. **`IChatPort.complete`** accepts an optional fourth parameter, **`options`**, with:
   - **`signal?: AbortSignal`** — when aborted, the async iterable must **terminate promptly** (stop yielding further chunks; underlying HTTP/stream closed or reader cancelled where applicable).
   - **`timeoutMs?: number`** — when set, the implementation must **fail or abort** the request if the provider does not begin or complete within the budget in a product-defined way (minimum: abort the outbound request and stop iteration; error propagation is implementation-defined but must not hang indefinitely).

2. **Default timeout source:** Callers (sidecar route / workflow) supply `timeoutMs` from **effective settings** (`chatTimeout` in the repository README [Plugin Settings](../../README.md#plugin-settings)), not hard-coded in core.

3. **`ISidecarTransport.streamChat`** gains an optional second argument **`options?: { signal?: AbortSignal }`** so the **plugin** can abort a stream without waiting for the model. When `signal` aborts:
   - The transport stops consuming sidecar output.
   - The sidecar handler **should** propagate abort to `IChatPort` (same `AbortSignal` or linked controller) so provider resources are released where possible.

4. **Stdio vs HTTP:** Framing for “client stopped listening” is transport-specific (SRV-1 / PLG-2 may use process signal, NDJSON cancel line, or connection close); this ADR only requires **observable behavior**: aborted streams end and in-flight work is best-effort cancelled on the sidecar.

---

## Consequences

**Positive**

- One pattern (`AbortSignal` + optional timeout) works for OpenAI, Ollama, and future providers.
- QA can verify cancellation with deterministic fakes and slow-stream mocks.

**Negative / costs**

- Every chat adapter must handle abort paths; partial vendor SDK support may require polyfills (e.g. `AbortController` + fetch).

---

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Timeout only inside each vendor adapter with no port parameter | Duplicates logic; hard to test from core; ignores user-configured `chatTimeout` consistently. |
| Separate `ICancellableChatPort` | Splits the ecosystem; all MVP providers need both stream and cancel. |
| No transport-level signal; only UI-side ignore | Wastes sidecar CPU/network; poor UX on slow models. |

---

## Explicit non-decisions

- This ADR does **not** define the exact NDJSON cancel frame for stdio (delegated to SRV-1 / transport stories).
- This ADR does **not** require HTTP/2 reset semantics; **best-effort** cancellation is sufficient for MVP.
- Embedding calls and indexing jobs are **out of scope**; only **chat completion** streaming is covered.

---

## Links

- Requirements: [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §6, §10
- Related README section: [API Contract](../../README.md#api-contract), [Plugin Settings](../../README.md#plugin-settings)
- Related stories: CHAT-1, CHAT-2
- Related ADRs: [ADR-005](ADR-005-provider-abstraction.md), [ADR-006](ADR-006-sidecar-architecture.md)
