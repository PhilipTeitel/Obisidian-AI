# REQ-008: Audit hardening and quality

**Source material:**

- [`docs/requests/Opus-review-2026-05-13.md`](../requests/Opus-review-2026-05-13.md) — code review covering security and secrets handling, code structure and hexagonal boundaries, and test quality.
- [`docs/requests/audit-findings-2026-05-12.md`](../requests/audit-findings-2026-05-12.md) — whole-repo audit report covering security, reliability, performance, and test coverage findings.
- User clarification in current chat (2026-05-14) — create one grouped `REQ-008` requirements document, include every high and medium finding from both source documents, reconcile overlaps, and group the changes so epics and stories can be planned sensibly.

**Date:** 2026-05-14
**Status:** Draft

---

## 1. Goals

- **Harden the local plugin-to-sidecar trust boundary** by removing credential leakage paths, validating loopback HTTP URLs with parsed URL components, enforcing WebSocket and HTTP origin policy, requiring bearer authentication in headers rather than query strings, and limiting authenticated request body size. (Opus `S-1`, `S-2`, `S-6`; audit `SEC-1`, `SEC-2`, `SEC-3`, `TEST-1`, `TEST-2`, `TEST-3`.)
- **Reduce sensitive logging and improve logging control** by preventing API keys, bearer tokens, provider URLs, response bodies, and noisy startup diagnostics from flowing through unredacted `console.*` or sidecar logs. (Opus `S-3`, `S-4`, `S-5`, `C-4`; audit `SEC-1`, `TEST-1`.)
- **Improve workflow reliability and responsiveness** for stdio cancellation, sidecar shutdown, HTTP chat streaming, and full-vault indexing so user-facing operations fail or progress predictably under stalls, large vaults, and long provider responses. (Audit `REL-1`, `REL-2`, `PERF-1`, `PERF-2`; Opus `T-4`.)
- **Strengthen architecture guardrails and code maintainability** by making core boundary checks enforce the intended invariant, splitting high-risk orchestration and query-construction hotspots, validating transport payloads at the boundary, and introducing a typed workflow error model. (Opus `C-1`, `C-2`, `C-3`, `C-5`, `C-6`.)
- **Make tests easier to read, more behavior-focused, and more reliable as regression evidence** while preserving traceability codes that connect tests to feature acceptance criteria and Gherkin scenarios. (Opus `T-1`, `T-2`, `T-3`, `T-4`, `T-5`, `T-6`; audit `TEST-1`, `TEST-2`, `TEST-3`.)

## 2. Non-goals

- **Not implementing fixes in this requirements pass.** This document refines audit findings into requirements only; architecture decisions, backlog epics, stories, and code changes belong to later workflow steps. (User request; `/refine-feature` workflow.)
- **Not including low-severity findings as standalone requirements.** Low findings may appear only as contextual examples when they support a high or medium requirement. (User clarification; source severity labels.)
- **Not removing traceability codes from tests.** The goal is to move codes out of the leading position in test names while preserving their value for acceptance-criteria and scenario traceability. (Opus `T-1`.)
- **Not replacing the plugin-sidecar architecture or the existing retrieval/storage substrate outright.** The source findings call for hardening, extraction, validation, and guardrails within the current architecture rather than a wholesale rewrite. (Opus `C-2`, `C-3`; audit System Map.)
- **Not defining exact implementation constants where the sources do not specify them.** Values such as HTTP body-size limits, indexing batch sizes, retry behavior, and concurrency caps must be selected during design or story planning and verified by tests. (Audit `SEC-3`, `PERF-1`; user clarification.)

## 3. Personas / actors

- **Vault owner using the plugin** — Runs chat, search, indexing, and progress UI inside Obsidian. They care that local credentials and vault content do not leak through logs or remote URLs, that cancellation works, and that long-running chat or indexing operations stay responsive. (Audit System Map; Opus `S-1`, `S-2`; audit `REL-1`, `PERF-1`, `PERF-2`.)
- **Plugin maintainer** — Maintains a TypeScript Obsidian plugin plus Node sidecar with strict layering and ADR/story traceability. They need executable guardrails, smaller workflow units, clear transport validation, and a typed error model so future changes do not silently weaken the architecture. (Opus `C-1` through `C-6`; audit Root Causes.)
- **Implementer / QA reviewer** — Converts requirements into epics, stories, regression tests, and acceptance evidence. They need reconciled source IDs, scenario IDs, behavior-first test names, and focused fixtures/contracts to keep implementation and verification aligned. (Opus `T-1` through `T-6`; audit `TEST-1` through `TEST-3`; user clarification.)
- **Support or debugging operator** — Reviews Obsidian console output, sidecar diagnostics, and user-submitted logs while diagnosing issues. They need enough non-secret information for debugging without raw session tokens, API keys, request bodies, provider response bodies, or excessive startup paths. (Opus `S-1`, `S-4`, `S-5`; audit `SEC-1`.)

## 4. User scenarios (Gherkin)

### S1 — Security: Sidecar startup does not expose the HTTP bearer token

```gherkin
Given the plugin starts the sidecar in HTTP transport mode
And   the sidecar produces the session token and HTTP URL needed for startup
When  startup diagnostics are written to stderr or forwarded to Obsidian console output
Then  the plugin still learns the session token and HTTP URL
And   the raw session token is never emitted through generic stderr logging, console output, or support-log-visible diagnostics
And   non-secret sidecar diagnostics remain available for debugging
```

*Traces to:* Opus `S-1`; audit `SEC-1`, `TEST-1`; user clarification to include all high/medium findings.

### S2 — Security: HTTP sidecar URLs are accepted only when they parse to the expected loopback origin

```gherkin
Given the plugin receives a sidecar HTTP URL during startup
When  the URL is validated before `/health` or any request carrying vault content, bearer tokens, or API keys is sent
Then  the URL is parsed with URL component semantics rather than string-prefix matching
And   only the expected `http://127.0.0.1:<port>` loopback shape is accepted
And   crafted URLs using host-prefix confusion, userinfo, non-HTTP schemes, or non-loopback hosts are rejected before any secret or vault payload is sent
```

*Traces to:* Audit `SEC-2`, `TEST-2`; Opus `S-2`, `S-6`.

### S3 — Security: HTTP and WebSocket requests enforce origin and header-based bearer authentication

```gherkin
Given the sidecar HTTP server is bound to loopback
And   the plugin communicates with it using bearer authentication
When  a browser-originated HTTP request or WebSocket upgrade reaches the sidecar
Then  the sidecar rejects requests whose `Origin` header is present and not in the allowed origin set
And   WebSocket upgrades require `Authorization: Bearer <token>`
And   bearer tokens in URL query parameters are not accepted for WebSocket authentication
And   existing bearer-authenticated plugin requests from allowed local origins continue to work
```

*Traces to:* Opus `S-2`, `S-6`; audit System Map HTTP trust-boundary notes.

### S4 — Security and performance: Authenticated HTTP JSON bodies are bounded before parsing

```gherkin
Given an authenticated client sends JSON to `/search`, `/chat`, `/index/full`, or `/index/incremental`
When  the request body exceeds the configured limit for that route or the shared JSON-body limit
Then  the sidecar returns `413 Payload Too Large`
And   the runtime handler for that route is not invoked
And   the sidecar does not buffer or parse the entire oversized body before rejecting it
And   normal supported chat, search, and indexing payloads continue to succeed
```

*Traces to:* Audit `SEC-3`, `TEST-3`; related performance pressure in audit `PERF-1`; Opus `S-2` context.

### S5 — Security: API keys, bearer tokens, and provider error details are structurally redacted from logs

```gherkin
Given chat, embedding, search, indexing, and provider-adapter code may emit diagnostic logs
When  any log path handles request payloads, provider failures, auth headers, URLs, or response bodies
Then  API keys and bearer tokens are redacted by logging configuration or never attached to the log event
And   provider failures log only safe operational fields such as status, provider, and duration
And   provider response bodies and full request URLs are not written to stdout, stderr, console, or pino logs
```

*Traces to:* Opus `S-3`, `S-4`, `S-5`, `C-4`; audit `SEC-1`.

### S6 — Architecture and security: Core and plugin diagnostics flow through explicit logging ports or debug gates

```gherkin
Given core workflows, plugin lifecycle code, and command handlers need diagnostic output
When  they log progress, warnings, or errors
Then  core workflow logging goes through an injected logging port instead of global `console.*`
And   plugin console logging that is not user-facing is gated behind an explicit debug setting or equivalent control
And   sidecar-owned logging can apply the same redaction policy to messages produced by core workflows
```

*Traces to:* Opus `S-5`, `C-4`; audit `SEC-1` logging exposure.

### S7 — Reliability: Stdio chat cancellation and adapter close settle pending work promptly

```gherkin
Given the plugin is using stdio transport
And   a chat stream or RPC request is waiting for a sidecar line or response
When  the user cancels the chat, starts a new conversation, closes the view, unloads the plugin, or the sidecar exits
Then  pending chat iterators and RPC promises settle promptly with a clear transport error or cancellation result
And   no caller remains indefinitely blocked waiting for another stdout line
And   normal request/response matching and push-line handling continue to work for successful requests
```

*Traces to:* Audit `REL-1`, `REL-2`; Opus `T-4` sidecar-disconnect test gap.

### S8 — Performance: Full-vault indexing uses bounded reads and bounded transport payloads

```gherkin
Given a vault contains many markdown notes
When  the user starts full or incremental indexing
Then  the plugin reads vault files with bounded concurrency
And   indexing work is sent to the sidecar in bounded batches or an equivalent bounded protocol
And   folder filtering, content hashing, daily-note settings, and index acknowledgements remain equivalent for supported vault sizes
And   the implementation has a regression test that proves the configured read concurrency or batching limit is enforced
```

*Traces to:* Audit `PERF-1`; related body-size pressure in audit `SEC-3`.

### S9 — Performance: HTTP chat yields NDJSON chunks as they arrive

```gherkin
Given the sidecar writes `/chat` responses as chunked NDJSON
And   the plugin is using HTTP transport
When  the provider produces a long or delayed streaming response
Then  the HTTP transport yields each complete NDJSON delta before the full response closes
And   the chat UI can render assistant text incrementally
And   abort signals are honored while the HTTP response stream is being read
And   terminal `done` handling, source metadata, grounding outcome defaults, and auth headers remain compatible
```

*Traces to:* Audit `PERF-2`; related responsiveness concern in audit `REL-1`.

### S10 — Architecture: Core boundary checks enforce the intended no-infrastructure invariant

```gherkin
Given CI or a local verification script checks source-layer boundaries
When  code under `src/core` imports platform, Node, logging, WebSocket, database, Obsidian, or sidecar-specific infrastructure modules
Then  the boundary check fails with a clear explanation
And   legitimate core imports and existing port abstractions continue to pass
And   the check covers the invariant claimed by the script documentation rather than only a narrow subset of forbidden imports
```

*Traces to:* Opus `C-1`.

### S11 — Architecture: Chat workflow orchestration is split by responsibility

```gherkin
Given chat can run through date/glob resolution, retrieval-only paths, agentic tool paths, synthesis, grounding validation, and streaming
When  maintainers change or test the chat workflow
Then  the top-level chat stream entry point remains a thin orchestrator
And   retrieval chat behavior and agentic chat behavior are implemented in separately testable units
And   existing retrieval, grounding, source, hybrid-search, and agentic behavior remains covered by focused tests
```

*Traces to:* Opus `C-2`.

### S12 — Architecture: SQLite vector search query construction is shared and testable

```gherkin
Given summary-vector and content-vector search methods apply similar filters and query clauses
When  filters, date ranges, tags, paths, or related search options are changed
Then  shared query-clause construction keeps filter semantics consistent across summary and content vector search
And   the query-building logic can be unit-tested without requiring every case to exercise the full SQLite adapter
And   existing SQL parameterization and search behavior are preserved
```

*Traces to:* Opus `C-3`.

### S13 — API contracts: Stdio transport payloads are parsed before workflow dispatch

```gherkin
Given the sidecar receives JSON messages over stdio
When  a chat, search, indexing, or other request payload is decoded
Then  the transport boundary validates the required shape before dispatching to workflows
And   malformed or version-mismatched payloads fail at the boundary with a clear transport error
And   unsafe double casts from `unknown` to workflow payload types are not used as the validation mechanism
```

*Traces to:* Opus `C-5`.

### S14 — Reliability and UX: Workflow failures carry typed phase and retryability context

```gherkin
Given workflows call ports for retrieval, storage, provider chat, embedding, and side effects
When  one of those calls fails
Then  the error reported by the workflow includes the failed phase, whether retry is appropriate, and the underlying cause when available
And   HTTP or plugin UI error messages are formatted from that typed context rather than exposing raw low-level messages alone
And   telemetry or diagnostics can distinguish retryable failures from terminal failures
```

*Traces to:* Opus `C-6`; audit reliability findings describe user-visible hangs and raw transport failures.

### S15 — Test quality: Behavior leads test names while traceability codes are preserved

```gherkin
Given existing tests encode acceptance-criteria or scenario trace codes such as `A1`, `B2`, `Y5`, and `S8`
When  maintainers read test names in source files or test runner output
Then  each test name starts with plain-English behavior in present tense
And   traceability codes appear as suffixes or parentheticals rather than as the load-bearing first words
And   logically related tests are grouped with nested `describe` blocks where that improves scanability
And   no traceability codes needed by feature documentation or story test plans are lost
```

*Traces to:* Opus `T-1`, `T-3`.

### S16 — Test quality: Brittle source-string assertions are replaced with behavioral evidence

```gherkin
Given a test intends to prove chat retrieval uses the shared retrieval helper or equivalent shared behavior
When  the underlying function name changes, is wrapped, or is refactored without changing behavior
Then  the test does not assert on the source-code string of the function
And   the test proves the behavior through observable calls, outputs, or port interactions such as the expected coarse retrieval parameters
```

*Traces to:* Opus `T-2`; related Opus `T-1` naming example.

### S17 — Test quality: Critical workflow edge cases have focused regression coverage

```gherkin
Given the plugin supports daily-note parsing, indexing, chat, provider calls, and agentic note tools
When  maintainers run the relevant workflow tests
Then  regressions are covered for malformed daily-note date patterns, embedding dimension mismatch, large-note chunking, sidecar disconnect mid-stream in agentic mode, rate-limit behavior or the explicit absence of retry, and repeated tool-call loop protection
And   each edge-case test asserts user-visible or workflow-visible behavior rather than only internal call counts
```

*Traces to:* Opus `T-4`; audit `REL-1`, `REL-2`, `PERF-2` for transport-facing failure modes.

### S18 — Test quality: Shared fixtures and contract suites keep doubles aligned with real adapters

```gherkin
Given multiple unit, integration, and contract tests need node records, embeddings, chat doubles, and document-store behavior
When  shared domain shapes or adapter contracts change
Then  tests use shared fixture builders for repeated records and fakes
And   contract tests run against both the real document-store adapter and the in-memory test double where both are used to validate the same behavior
And   test doubles fail quickly when they drift from real adapter semantics
```

*Traces to:* Opus `T-5`, `T-6`.

## 5. Constraints

- **Source traceability:** Every story planned from this requirement must cite the relevant `Sn` scenario IDs and original source finding IDs so overlap between Opus and audit findings remains visible. (User clarification; `/refine-feature` workflow.)
- **Severity scope:** Standalone scenarios must come from high or medium findings in the source documents; low-severity findings are out of scope unless referenced only as context. (User clarification.)
- **Loopback transport boundary:** HTTP sidecar communication must remain loopback-only and must reject parsed URL shapes that are not the expected local sidecar endpoint. (Audit `SEC-2`; Opus `S-2`, `S-6`.)
- **Secret handling:** Session tokens, API keys, authorization headers, and provider response bodies must not be written to user-visible logs, global console output, stderr forwarding, or provider adapter warnings. (Opus `S-1`, `S-3`, `S-4`, `S-5`; audit `SEC-1`.)
- **WebSocket authentication:** WebSocket upgrades must use header-based bearer authentication and must not accept token-bearing query strings as an authentication path. (Opus `S-2`.)
- **Origin enforcement:** HTTP and WebSocket routes must reject present-but-unapproved `Origin` headers while preserving the legitimate plugin path. (Opus `S-2`, `S-6`.)
- **Request sizing:** JSON body parsing for authenticated HTTP routes must enforce byte limits before full buffering or parsing and must return a 413 response for oversized requests. (Audit `SEC-3`, `TEST-3`.)
- **Hexagonal boundaries:** `src/core` must stay independent of Obsidian, SQLite, Node platform modules, sidecar transport libraries, and concrete logging infrastructure. (Opus `C-1`, `C-4`.)
- **Regression evidence:** Security hardening work must include tests for token redaction, localhost URL parsing, and HTTP body limits; test-quality work must preserve trace codes while improving readable behavior names. (Audit `TEST-1`, `TEST-2`, `TEST-3`; Opus `T-1`.)
- **Compatibility:** Existing supported plugin behaviors such as chat, search, full and incremental indexing, source metadata, grounding outcomes, and progress reporting must remain functionally equivalent unless a later design explicitly changes them. (Audit `SEC-3`, `PERF-1`, `PERF-2`; Opus `C-2`, `C-3`.)

## 6. Resolved questions

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| 1 | How should the requirements artifact be structured for planning epics and stories? | Create one `REQ-008` requirements document with grouped sections/scenarios by category and reconciled overlap. | user (2026-05-14) |
| 2 | Which high/medium findings should be included from the two source documents? | Include every high and medium finding from both documents, including deferred medium audit findings and medium test coverage recommendations. | user (2026-05-14) |

## 7. Open questions

None.

## 8. Suggested ADR triggers

| Trigger | Why it likely needs an ADR | Related Sn |
|---------|----------------------------|------------|
| Sidecar session-token handoff channel | Moving the token away from shared stderr or defining a redacted stderr handshake is a durable transport/security decision that affects plugin startup, support diagnostics, and future sidecar transports. | S1 |
| Local HTTP and WebSocket trust model | Parsed loopback URL validation, allowed origins, header-only bearer authentication, and rejection of query-string tokens define the long-lived local transport contract. | S2, S3 |
| Logging and redaction policy | Introducing a core logging port, plugin debug gates, pino redaction, and provider adapter logging rules creates a cross-layer policy for diagnostics and secret handling. | S5, S6 |
| HTTP body limits and indexing payload protocol | Selecting request-size limits, batching, streaming, or chunked indexing behavior affects the plugin-sidecar API contract and supported vault-size envelope. | S4, S8 |
| Stdio transport cancellation and close semantics | Defining how pending streams and RPCs settle on abort, sidecar exit, or adapter close is a durable transport behavior with UI and test implications. | S7 |
| Core workflow decomposition and error model | Splitting chat orchestration and adding typed workflow errors changes internal extension boundaries and how failures are surfaced through HTTP and plugin UI. | S11, S14 |
| Adapter contract and test-double policy | Requiring contract suites to run against real adapters and in-memory doubles defines a project-level testing invariant for future ports and adapters. | S18 |

## 9. Links

- Source material: see header.
- Related REQ files: None identified in this refinement pass.
- Related ADRs: Existing retrieval and architecture ADRs may be referenced during design where scenario-specific stories touch prior decisions, especially the retrieval-helper invariant cited by Opus `T-2`.

---

*Created: 2026-05-14 | Refined by: architect in Discovery Mode*
