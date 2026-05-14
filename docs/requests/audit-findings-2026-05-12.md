<!--
Audit report contract:
- Use this template exactly.
- Keep all headings and heading order exactly as written.
- Do not remove sections, even when they are empty.
- If a section has no content yet, write `None yet.` under that heading.
- Do not introduce new top-level sections.
- Do not replace the `Detailed Findings` subsections with tables.
- Under `Detailed Findings`, each finding must use the bullet fields defined for its category.
- `Findings Summary` and `Execution Log` may use markdown tables; the detailed finding sections may not.
- Every finding must appear in both `Findings Summary` and the matching `Detailed Findings` subsection.
- Every selected fix must appear in both `Fix Plan` and `Execution Log`.
- The `Decision` field in each detailed finding is the source of truth for triage.
- Every non-`TEST-#` finding must include `Severity`, `Confidence`, and `Evidence checked`.
- `Decision: fix now` means the finding belongs in `Fix Plan -> Selected Fixes`.
- `Decision: defer` means the finding belongs in `Deferred Findings` and must include `Why not now`.
-->

# Audit Report

## Scope And Timebox
- Scope: `whole-repo`
- Repository: `/Users/philipteitel/code/Obisidian-AI-MVP`
- Stack(s) detected: Obsidian plugin TypeScript, Node sidecar, HTTP/stdio transport, SQLite/better-sqlite3, OpenAI/Ollama adapters.
- Time budget (optional): Security command pass.
- Goal: Identify concrete security defects in authentication, trust boundaries, injection, path traversal, sensitive logging, and denial-of-service paths.
- Constraints: Update security findings only; no application code changes.
- Highest-priority verification commands: `npm test -- tests/plugin/client/HttpTransportAdapter.test.ts tests/sidecar/http/httpServer.test.ts`, `npm run typecheck`

## System Map
### Architecture
- Apps/services: Obsidian plugin process, spawned Node sidecar process, optional loopback HTTP server, default stdio RPC.
- Shared libraries: Core domain/workflow code under `src/core`, plugin adapters under `src/plugin`, sidecar adapters under `src/sidecar`.
- External dependencies: OpenAI-compatible HTTP APIs, Ollama HTTP API, SQLite/sqlite-vec.
- Highest-risk boundaries: Plugin-to-sidecar HTTP handshake and bearer token, sidecar HTTP request bodies carrying vault content/API keys, provider base URLs, vault file reads and generated note writes.

### Review Coverage
- Deeply reviewed packages: `src/sidecar/http`, `src/plugin/client`, `src/plugin/ui`, `src/plugin/vault`, `src/plugin/agent`, `src/sidecar/runtime`, `src/sidecar/adapters`.
- Lightly reviewed packages: `src/core/workflows`, `src/core/domain`, tests and feature docs relevant to the audited security paths.
- Not inspected yet: Release packaging and Obsidian marketplace distribution metadata.
- Risk hotspots: Loopback HTTP auth, stderr/stdout process handshake, request sizing, URL parsing, local provider boundaries.
- Safest likely fix candidates: Redact handshake secrets before logging, parse URLs with `URL` and exact hostname checks, enforce authenticated HTTP body limits.

### Data Flow
- Ingress: Obsidian UI commands/views, plugin settings, vault files, sidecar stdio lines, optional sidecar HTTP REST/WS requests.
- Validation: Some vault path and glob validation; HTTP auth checks bearer token before route dispatch.
- Core business logic: Indexing, search retrieval, grounded chat, agent note tool assembly.
- Persistence and side effects: SQLite DB writes, Obsidian vault reads/writes for plugin-owned paths, external provider HTTP calls.
- Egress: Provider API requests, HTTP/stdio responses, progress pushes, Obsidian UI rendering, console/pino logs.

### Build System
- Workspace manager and task runner: npm scripts in `package.json`.
- Root scripts: `build`, `typecheck`, `lint`, `test`, `verify:stack`, `check:boundaries`.
- Package build/typecheck flow: esbuild for plugin/sidecar bundles, multiple TypeScript project typechecks.
- TypeScript config relationships: Separate core, plugin, sidecar, and test configs.
- CI entrypoints: Not inspected.

### Test Infrastructure
- Test frameworks: Vitest.
- Test locations: `tests/core`, `tests/plugin`, `tests/sidecar`, `tests/integration`, `tests/contract`.
- Unit vs integration boundaries: Core workflow tests are in-process; plugin/sidecar transport tests mock Obsidian or loopback HTTP; integration tests cover SQLite/provider boundaries.
- Smallest useful verification commands: `npm test -- tests/plugin/client/HttpTransportAdapter.test.ts tests/sidecar/http/httpServer.test.ts`, `npm run typecheck`

## Findings Summary
Use category-specific IDs:
- `API-#` for API contract findings
- `DB-#` for database findings
- `REL-#` for reliability findings
- `SEC-#` for security findings
- `PERF-#` for performance findings
- `TOOL-#` for tooling findings
- `TEST-#` for test coverage recommendations

Every finding must include a severity. Use one of: `critical`, `high`, `medium`, `low`.
Every non-`TEST-#` finding must include a confidence. Use one of: `high`, `medium`, `low`.
Order findings by severity descending within each category.
The `Fix now?` column must match the finding's `Decision` field.
Severity rubric:
- `critical`: broad production breakage, hard-stop delivery risk, or directly exploitable behavior with severe impact
- `high`: likely production issue or exploitable defect with meaningful blast radius
- `medium`: real defect or risk with bounded blast radius or preconditions
- `low`: worthwhile but lower-impact issue, weak trigger, or narrow edge case
Confidence rubric:
- `high`: directly supported by code/config and a concrete trigger or verification path
- `medium`: strongly suggested by code/config with one assumption that should be called out
- `low`: plausible but incomplete evidence; prefer omitting unless it materially affects triage
For deferred non-`TEST-#` findings, use `Why not now` values like `broad blast radius`, `unclear reproduction`, `needs environment access`, `cross-service change`, `insufficient time`, or `other: ...`.

| ID | Category | Severity | Confidence | Short title | Fix now? | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| REL-1 | Reliability | medium | high | Stdio chat cancellation can hang while waiting for another line | no | Add an abort-while-idle `streamChat` test in `tests/plugin/client/StdioTransportAdapter.test.ts` |
| REL-2 | Reliability | medium | high | Stdio RPC promises are not rejected when the adapter closes | no | Add a pending `send()` then `close()` rejection test in `tests/plugin/client/StdioTransportAdapter.test.ts` |
| SEC-1 | Security | medium | high | HTTP bearer token is logged during sidecar handshake | yes | Add a SidecarLifecycle stderr test that handshake lines are consumed/redacted, then run `npm test -- tests/plugin/client/SidecarLifecycle.test.ts` |
| SEC-2 | Security | medium | high | Localhost validation accepts non-loopback URLs | yes | Add exact URL parsing cases for `127.0.0.1.evil` and `127.0.0.1@host`, then run `npm test -- tests/plugin/client/HttpTransportAdapter.test.ts` |
| SEC-3 | Security | medium | high | Authenticated HTTP request bodies are unbounded | yes | Add 413 tests for oversized `/search`, `/chat`, and `/index/full` bodies, then run `npm test -- tests/sidecar/http/httpServer.test.ts` |
| PERF-1 | Performance | medium | high | Full-vault indexing reads every note concurrently into one payload | no | Add a large-vault or mocked-read concurrency test around `buildIndexPayload` |
| PERF-2 | Performance | medium | high | HTTP chat buffers the full NDJSON response before yielding chunks | no | Add an HTTP transport stream test that yields before the response closes |
| PERF-3 | Performance | low | high | Progress polling fetches and renders every job row every two seconds | no | Add a status-response limit test and UI render test for large job counts |
| TEST-1 | Test Coverage | medium | n/a | Missing regression for sidecar token redaction | yes | Add a mocked sidecar stderr/startup test in `tests/plugin/client/SidecarLifecycle.test.ts` |
| TEST-2 | Test Coverage | medium | n/a | Missing regression for parsed localhost validation | yes | Add prefix-confusion URL cases in `tests/plugin/client/HttpTransportAdapter.test.ts` |
| TEST-3 | Test Coverage | medium | n/a | Missing regression for HTTP request body limits | yes | Add oversized-body 413 cases in `tests/sidecar/http/httpServer.test.ts` |

## Detailed Findings
Each audit command should update only its assigned subsection below and the summary rows for findings it adds or changes.
Every detailed finding must include the same severity shown in `Findings Summary`.
Deferred non-`TEST-#` findings must include a concise `Why not now`.
Do not use tables in this section.

### API Contracts
None yet.

### Reliability
#### REL-1. Stdio chat cancellation can hang while waiting for another line
- Severity: medium
- Confidence: high
- Files and lines: `src/plugin/client/StdioTransportAdapter.ts:107-118`, `src/plugin/client/StdioTransportAdapter.ts:141-143`, `src/plugin/ui/ChatView.ts:79-81`, `src/plugin/ui/ChatView.ts:197-216`
- Evidence checked: `ChatView.cancelStream()` aborts an `AbortController`, and `sendUserMessage()` passes that signal into `transport.streamChat`. In the stdio transport, `streamChat()` checks `signal.aborted` before and after `await this.nextLine()`, but the abort listener is a no-op and `nextLine()` cannot be interrupted while it is waiting for stdout.
- Failure mode: Cancel, close, or "New conversation" during a quiet provider call can leave the async iterator stuck until the sidecar writes another line. The UI coroutine remains in flight, cleanup in `finally` is delayed, and a subsequent chat can overlap with the stuck reader.
- Trigger conditions: Default `stdio` transport, a chat request that has not produced a line yet or stalls between lines, and user cancellation or view close before the next sidecar stdout line arrives.
- Root cause: Abort is polled around a blocking `nextLine()` promise instead of racing or rejecting the pending line waiter when the signal fires.
- Minimal safe fix: Make `nextLine()` abort-aware, remove the pending waiter on abort, and have `streamChat()` reject or return promptly when the signal fires; if the protocol later supports server-side cancellation, also send a cancel frame.
- Behavior to preserve: Normal line demultiplexing for push messages and terminal `done` messages must remain unchanged.
- Regression test idea: In `tests/plugin/client/StdioTransportAdapter.test.ts`, call `streamChat()` with a fake stdout that never emits a line, abort the signal, and assert `next()` settles within a short bounded time.
- Verification: `npm test -- tests/plugin/client/StdioTransportAdapter.test.ts`
- Related finding IDs or overlaps: Related to `PERF-2` because both affect chat streaming responsiveness, but this is a stdio cancellation reliability defect.
- Decision: `defer`
- Why not now: `other: prioritize after SEC-1/SEC-2/SEC-3 fix-now hardening`

#### REL-2. Stdio RPC promises are not rejected when the adapter closes
- Severity: medium
- Confidence: high
- Files and lines: `src/plugin/client/StdioTransportAdapter.ts:21-24`, `src/plugin/client/StdioTransportAdapter.ts:84-96`, `src/plugin/client/StdioTransportAdapter.ts:146-153`, `src/plugin/client/SidecarLifecycle.ts:375-379`
- Evidence checked: `send()` stores pending request resolvers in `this.pending` and only removes them when a matching response or error line arrives. `close()` marks the adapter closed and wakes `lineWaiters`, but it never rejects or clears `pending`. `SidecarLifecycle` logs child `exit` and `close` events without closing the adapter or rejecting in-flight requests.
- Failure mode: If the sidecar exits, stdout closes, or the plugin unloads while `send()` is waiting for `/health`, `index/status`, `chat/clear`, or indexing acknowledgements, callers can await forever with no error surfaced to the UI.
- Trigger conditions: Sidecar crash or shutdown during an in-flight stdio RPC, or plugin unload/adapter close while a non-chat request is pending.
- Root cause: The stdio transport has no terminal error path for pending RPC promises and the lifecycle does not propagate child process termination into the transport.
- Minimal safe fix: Reject all pending requests in `StdioTransportAdapter.close()`, attach stdout/readline close or error handlers that call the same rejection path, and have `SidecarLifecycle` close the adapter on child exit/close.
- Behavior to preserve: Successful request/response matching by `id` and push-line handling for chat streams must continue to work.
- Regression test idea: In `tests/plugin/client/StdioTransportAdapter.test.ts`, start `adapter.send({ type: 'health' })` without writing a response, call `adapter.close()`, and assert the promise rejects with a transport-closed error.
- Verification: `npm test -- tests/plugin/client/StdioTransportAdapter.test.ts`
- Related finding IDs or overlaps: None.
- Decision: `defer`
- Why not now: `other: prioritize after SEC-1/SEC-2/SEC-3 fix-now hardening`

### Database
None yet.

### Security
#### SEC-1. HTTP bearer token is logged during sidecar handshake
- Severity: medium
- Confidence: high
- Files and lines: `src/sidecar/server.ts:36-48`, `src/plugin/client/SidecarLifecycle.ts:369-373`, `src/plugin/client/SidecarLifecycle.ts:430-436`
- Evidence checked: The HTTP sidecar generates a per-session bearer token and writes `OBSIDIAN_AI_SESSION_TOKEN=<token>` to stderr for the plugin handshake. The plugin registers a generic `child.stderr.on('data')` handler before the handshake completes and logs every non-empty stderr chunk, while the handshake parser separately reads the token from stderr lines.
- Exploit scenario: In HTTP transport mode, the session bearer token is copied into Obsidian/Electron console output or logs. A local plugin, support log bundle, or user-space process with access to those logs can replay the token against `127.0.0.1:<port>` until the sidecar exits, then call endpoints such as `/index/status`, `/search` in local-provider configurations, or expensive indexing/chat operations.
- Root cause: The handshake secret and ordinary sidecar diagnostics share stderr, and the generic stderr logger does not redact or suppress handshake lines.
- Minimal safe fix: Handle handshake lines before attaching the generic stderr logger, or route handshake data over a non-logged pipe; in either case, redact `OBSIDIAN_AI_SESSION_TOKEN=` values from any stderr logging path.
- Behavior to preserve: The plugin must still learn the session token and HTTP URL during startup, and non-secret sidecar stderr should remain visible for debugging.
- Backward-compatibility or migration notes: No persisted data migration; logs should lose the raw token value.
- Verification: Add a focused `SidecarLifecycle` test with fake stderr chunks containing `OBSIDIAN_AI_SESSION_TOKEN=` and assert the generic logger never receives the raw token; manually verify HTTP mode still starts.
- Related finding IDs or overlaps: SEC-3 becomes easier to exploit when this token is exposed.
- Decision: `fix now`
- Why not now: `n/a`

#### SEC-2. Localhost validation accepts non-loopback URLs
- Severity: medium
- Confidence: high
- Files and lines: `src/plugin/client/HttpTransportAdapter.ts:11-15`, `src/plugin/client/SidecarLifecycle.ts:399-401`, `src/plugin/client/SidecarLifecycle.ts:449-455`
- Evidence checked: `assertLocalhost` only checks `baseUrl.startsWith('http://127.0.0.1')`. Strings such as `http://127.0.0.1.evil.example` and `http://127.0.0.1@evil.example` satisfy that prefix but are not loopback hosts when parsed as URLs. `SidecarLifecycle` trusts the sidecar-provided handshake URL, calls `/health`, then constructs `HttpTransportAdapter` with the same URL.
- Exploit scenario: If a spoofed sidecar process or tampered plugin bundle emits `OBSIDIAN_AI_HTTP_URL=http://127.0.0.1@attacker.example`, the plugin accepts it as local, sends the bearer token to the remote `/health` endpoint, and later sends vault queries, chat messages, and API-key-bearing request bodies to that host.
- Root cause: Security-sensitive host validation is implemented as string-prefix matching instead of parsed URL component checks.
- Minimal safe fix: Parse with `new URL(baseUrl)`, require `protocol === 'http:'`, `hostname === '127.0.0.1'`, no username/password, and a valid explicit port or trusted URL shape.
- Behavior to preserve: Legitimate sidecar URLs like `http://127.0.0.1:<ephemeral-port>` should continue to work, including a trailing slash.
- Backward-compatibility or migration notes: Configurations relying on `localhost`, IPv6 loopback, userinfo, or non-loopback aliases would be rejected; current sidecar output already uses `127.0.0.1`.
- Verification: Extend `HttpTransportAdapter` tests to reject `http://127.0.0.1.evil/`, `http://127.0.0.1@evil/`, credentials, and non-HTTP schemes while accepting `http://127.0.0.1:9/`.
- Related finding IDs or overlaps: SEC-1 covers local token disclosure; this finding covers remote exfiltration caused by a distinct URL parsing bug.
- Decision: `fix now`
- Why not now: `n/a`

#### SEC-3. Authenticated HTTP request bodies are unbounded
- Severity: medium
- Confidence: high
- Files and lines: `src/sidecar/http/httpServer.ts:113-148`, `src/sidecar/http/httpServer.ts:180-184`, `src/core/domain/types.ts:186-205`, `src/core/domain/types.ts:347-373`
- Evidence checked: `/search`, `/index/full`, `/index/incremental`, and `/chat` all call `readBody(req)` and then `JSON.parse(raw)`. `readBody` accumulates every incoming chunk into an array and concatenates it with no `Content-Length` check, streaming byte counter, route-specific cap, or early socket destruction. The wire types include arbitrarily large arrays and strings such as `IndexFullRequest.files[].content`, `deletedPaths`, chat `messages`, `tags`, and `pathGlobs`.
- Exploit scenario: A local attacker who obtains the HTTP bearer token, or any authorized debugging client, can POST a very large JSON body to `/index/full` or `/chat`. The sidecar buffers it fully in memory before parsing, causing process memory exhaustion or long event-loop stalls; repeated requests can keep the sidecar unavailable for the Obsidian plugin.
- Root cause: The HTTP transport treats local authenticated clients as trusted and lacks maximum request-size enforcement before buffering and parsing JSON.
- Minimal safe fix: Add a shared `readJsonBody` helper with a conservative byte limit, enforce `Content-Length` when present, count streamed bytes, destroy or drain over-limit requests, return `413 Payload Too Large`, and use tighter per-route caps where possible.
- Behavior to preserve: Normal full-vault indexing must still support expected vault sizes; stdio transport behavior can remain unchanged unless separately audited.
- Backward-compatibility or migration notes: Large vaults may need a documented cap or chunked indexing protocol; choose a limit that preserves supported MVP vault sizes.
- Verification: Add HTTP tests that an oversized body returns 413 without calling runtime handlers, and that normal `/search`, `/chat`, and `/index/full` payloads still succeed.
- Related finding IDs or overlaps: SEC-1 increases the chance that an unauthorized local process gets the bearer token needed to trigger this path.
- Decision: `fix now`
- Why not now: `n/a`

### Performance
#### PERF-1. Full-vault indexing reads every note concurrently into one payload
- Severity: medium
- Confidence: high
- Files and lines: `src/plugin/commands/registerCommands.ts:28-48`, `src/plugin/vault/ObsidianVaultAccess.ts:143-148`, `src/plugin/client/HttpTransportAdapter.ts:50-55`, `src/plugin/client/HttpTransportAdapter.ts:60-65`
- Evidence checked: `buildIndexPayload()` enumerates all markdown files, then uses `Promise.all(filesMeta.map(... access.readFile ...))` to read every note concurrently and return a single `files` array containing full note contents and hashes. HTTP transport then serializes that full payload with `JSON.stringify(request.payload)` for `/index/full` and `/index/incremental`.
- Why this is on a hot or scalable path: Full and incremental reindex commands are core workflows, and vault size can realistically grow to thousands of markdown files.
- Expected impact: Large vaults can cause a burst of concurrent Obsidian vault reads, high memory use from materializing all note contents at once, long main-process stalls, and very large stdio/HTTP messages before the sidecar can start processing any job.
- Root cause: The plugin builds an eager, whole-vault request payload rather than using bounded read concurrency or batching.
- Minimal safe fix: Read files with a bounded concurrency limit and send indexing work in batches, or introduce a streaming/chunked indexing protocol that lets the sidecar enqueue and process partial batches.
- Behavior to preserve: Folder inclusion/exclusion, content hashing, daily-note settings, and existing index acknowledgements must stay equivalent for normal vault sizes.
- Verification: Add a mocked vault test that counts concurrent `readFile` calls during full reindex and asserts the configured limit, plus a batching test that verifies all files are eventually sent.
- Related finding IDs or overlaps: Overlaps with `SEC-3` on large HTTP bodies; this finding covers plugin-side I/O and memory amplification before the sidecar receives the request.
- Decision: `defer`
- Why not now: `broad blast radius`

#### PERF-2. HTTP chat buffers the full NDJSON response before yielding chunks
- Severity: medium
- Confidence: high
- Files and lines: `src/plugin/client/HttpTransportAdapter.ts:101-137`, `src/sidecar/http/httpServer.ts:146-168`, `src/plugin/ui/ChatView.ts:197-220`
- Evidence checked: The sidecar HTTP server writes chat as chunked NDJSON inside the `/chat` handler, but `HttpTransportAdapter.streamChat()` awaits `r.text()` before splitting lines and yielding deltas. `ChatView` renders assistant text only as chunks are yielded from `transport.streamChat()`.
- Why this is on a hot or scalable path: Chat streaming is the primary interactive user path, and long provider responses are expected.
- Expected impact: HTTP transport loses incremental rendering, stores the whole chat response in memory, delays source/delta handling until the provider finishes, and makes long responses feel hung even though the sidecar is writing chunks.
- Root cause: The HTTP client treats a streaming response as a complete text body instead of parsing `ReadableStream` chunks incrementally.
- Minimal safe fix: Use `res.body.getReader()` with `TextDecoder`, maintain a line buffer, parse each complete NDJSON line, and yield deltas as they arrive while honoring the caller's abort signal.
- Behavior to preserve: Existing terminal `done` shape, fallback defaults for missing `sources`/`groundingOutcome`, and auth headers must stay unchanged.
- Verification: Add an `HttpTransportAdapter` test with a delayed `ReadableStream` response and assert the first yielded delta arrives before the stream closes.
- Related finding IDs or overlaps: Related to `REL-1`, but this finding is specific to HTTP transport latency and buffering.
- Decision: `defer`
- Why not now: `other: prioritize after SEC-1/SEC-2/SEC-3 fix-now hardening`

#### PERF-3. Progress polling fetches and renders every job row every two seconds
- Severity: low
- Confidence: high
- Files and lines: `src/plugin/ui/ProgressSlideout.ts:7-8`, `src/plugin/ui/ProgressSlideout.ts:41-43`, `src/plugin/ui/ProgressSlideout.ts:70-92`, `src/sidecar/runtime/SidecarRuntime.ts:238-269`, `src/sidecar/adapters/JobStepService.ts:258-260`
- Evidence checked: Opening the progress view starts a two-second interval. Each refresh calls `index/status`; the sidecar returns `jobs: this.jobSteps!.listJobSteps()`, and `listJobSteps()` runs `SELECT * FROM job_steps` without a limit. The UI empties and recreates a table row for every returned job on each poll.
- Why this is on a hot or scalable path: The progress view is likely used during full-vault indexing, where one job row can exist per indexed note.
- Expected impact: Large vaults can produce oversized status responses, repeated full-table SQLite scans, and repeated DOM churn every two seconds, making the progress UI slow while indexing is already consuming resources.
- Root cause: The status API mixes summary counters with an unbounded detail list, and the UI renders the full detail list on every polling tick.
- Minimal safe fix: Keep summary counters unbounded, but cap or paginate job details; prefer active/recent failed jobs by default and add an explicit "show more" path if full history is needed.
- Behavior to preserve: The summary counts for pending, processing, completed, failed, and dead-letter jobs must remain accurate.
- Verification: Add a sidecar status test that seeds many `job_steps` rows and asserts the detail list is capped while counters remain correct; add a UI test that renders the capped list.
- Related finding IDs or overlaps: None.
- Decision: `defer`
- Why not now: `other: lower impact than current security fix-now set`

### Tooling
None yet.

### Test Coverage Recommendations
#### TEST-1. Missing regression for sidecar token redaction
- Severity: medium
- Finding or issue ID (`TEST-#`): TEST-1; supports `SEC-1`
- Missing regression test: No test exercises HTTP-mode sidecar startup stderr handling or asserts that `OBSIDIAN_AI_SESSION_TOKEN=` lines are consumed without being emitted through the generic sidecar stderr logger.
- Why it matters: `SEC-1` is a credential-disclosure bug; a fix that only changes handshake parsing but leaves another stderr path logging the token would still expose the bearer token.
- Exact code path protected: `src/plugin/client/SidecarLifecycle.ts` HTTP `start()` path that attaches `child.stderr.on('data')`, calls `readHttpHandshake(child)`, parses `OBSIDIAN_AI_SESSION_TOKEN=`, and constructs `HttpTransportAdapter`.
- Lightest-weight way to add it: In `tests/plugin/client/SidecarLifecycle.test.ts`, mock `node:child_process.spawn` to return a fake child with controllable stdout/stderr streams, spy on `console.error`, emit the token and URL handshake lines, and assert the raw token never appears in logged stderr while startup still resolves.
- Verification gap: Current `SidecarLifecycle` tests cover `vaultDefaultDbPath`, Node resolution, and nvm alias handling only; they never instantiate the lifecycle HTTP startup path or observe stderr logging.

#### TEST-2. Missing regression for parsed localhost validation
- Severity: medium
- Finding or issue ID (`TEST-#`): TEST-2; supports `SEC-2`
- Missing regression test: `HttpTransportAdapter` rejects `http://example.com/`, but has no cases for prefix-confusion URLs that pass `startsWith('http://127.0.0.1')` while resolving to a non-loopback host.
- Why it matters: `SEC-2` is a small parser-boundary fix that can regress if future code returns to string prefix checks; the test should pin the exact host/protocol invariant.
- Exact code path protected: `src/plugin/client/HttpTransportAdapter.ts` constructor path through `assertLocalhost(baseUrl.replace(/\/$/, ''))`.
- Lightest-weight way to add it: Extend `tests/plugin/client/HttpTransportAdapter.test.ts` with synchronous constructor assertions rejecting `http://127.0.0.1.evil.example/`, `http://127.0.0.1@evil.example/`, URLs with credentials, and non-HTTP schemes, while preserving the existing acceptance of `http://127.0.0.1:9`.
- Verification gap: Current tests prove a broad non-local hostname is rejected and auth headers are sent, but not the crafted URL forms that create the exploit.

#### TEST-3. Missing regression for HTTP request body limits
- Severity: medium
- Finding or issue ID (`TEST-#`): TEST-3; supports `SEC-3`
- Missing regression test: The HTTP server has no test that oversized authenticated bodies are rejected before `JSON.parse` or runtime handler invocation.
- Why it matters: `SEC-3` is a denial-of-service boundary; without an over-limit test, a body-size helper could be wired to one route but missed on `/chat`, `/index/full`, or `/index/incremental`.
- Exact code path protected: `src/sidecar/http/httpServer.ts` POST handlers for `/search`, `/index/full`, `/index/incremental`, and `/chat`, plus the shared `readBody(req)` buffering path that currently accumulates all chunks without a byte limit.
- Lightest-weight way to add it: In `tests/sidecar/http/httpServer.test.ts`, start the loopback server with the existing real `SidecarRuntime` or a minimal runtime stub, POST an authenticated body just over the configured limit to representative JSON routes, assert `413`, and assert the corresponding runtime method was not called.
- Verification gap: Current HTTP tests cover loopback binding, missing bearer rejection, and authenticated `/health`; they do not exercise any POST body path or resource-exhaustion guard.

## Fix Plan
### Selected Fixes
Populate this section only from non-`TEST-#` findings whose `Decision` is `fix now`.
#### SEC-1
- Why this ranks well for the assessment: It directly exposes the HTTP bearer token that protects local vault/search endpoints.
- Expected fix size: Small.
- Narrowest files to change: `src/plugin/client/SidecarLifecycle.ts`.
- Existing tests to anchor on: `tests/plugin/client/SidecarLifecycle.test.ts`.
- Lightest new or updated regression test: Simulate stderr handshake lines and assert the raw token is not logged by the generic stderr path.
- Smallest validation commands: `npm test -- tests/plugin/client/SidecarLifecycle.test.ts`
- Behavior to preserve: HTTP handshake still returns token and URL; non-secret stderr remains visible.
- Commit message: `fix sidecar handshake token logging`

#### SEC-2
- Why this ranks well for the assessment: It is a narrow trust-boundary bug with a simple, high-confidence URL parser fix.
- Expected fix size: Small.
- Narrowest files to change: `src/plugin/client/HttpTransportAdapter.ts`.
- Existing tests to anchor on: `tests/plugin/client/HttpTransportAdapter.test.ts`.
- Lightest new or updated regression test: Reject prefix-confusion URLs and accept the sidecar's exact `127.0.0.1` URL form.
- Smallest validation commands: `npm test -- tests/plugin/client/HttpTransportAdapter.test.ts`
- Behavior to preserve: `http://127.0.0.1:<port>` with optional trailing slash continues to work.
- Commit message: `fix localhost URL validation`

#### SEC-3
- Why this ranks well for the assessment: It hardens the exposed HTTP surface against local resource exhaustion without touching core workflows.
- Expected fix size: Small to medium.
- Narrowest files to change: `src/sidecar/http/httpServer.ts`, `tests/sidecar/http/httpServer.test.ts`.
- Existing tests to anchor on: `tests/sidecar/http/httpServer.test.ts`.
- Lightest new or updated regression test: POST oversized JSON and assert 413 plus no runtime call.
- Smallest validation commands: `npm test -- tests/sidecar/http/httpServer.test.ts`
- Behavior to preserve: Existing authenticated HTTP routes and normal payloads continue to work.
- Commit message: `limit sidecar HTTP request bodies`

### Test Coverage Support
- `SEC-1` should be protected by `TEST-1` before or alongside the fix; this materially affects confidence because the vulnerable behavior is the interaction between handshake parsing and generic stderr logging, not just token generation.
- `SEC-2` should be protected by `TEST-2`; this is the cheapest high-signal regression because the exploit is entirely in constructor URL validation.
- `SEC-3` should be protected by `TEST-3`; this materially affects confidence because every JSON POST route needs the limit, and the current HTTP tests do not touch POST bodies.

## Issue Execution Loop
For each selected issue:
1. Restate the bug or risk and the behavior that must stay the same.
2. Find the narrowest code path and the nearest existing tests.
3. Add or update the lightest regression test that proves the intended behavior.
4. Implement the minimal safe fix.
5. Run the smallest relevant checks first, then broader package or root checks only if needed.
6. Summarize the change in `Execution Log`.
7. Commit immediately with a concise message focused on intent.

## Execution Log
| Issue | Code change summary | Tests updated | Commands run | Result | Commit |
| --- | --- | --- | --- | --- | --- |
| SEC-1 | Not implemented in this audit pass | Not updated | Not run | Pending | n/a |
| SEC-2 | Not implemented in this audit pass | Not updated | Not run | Pending | n/a |
| SEC-3 | Not implemented in this audit pass | Not updated | Not run | Pending | n/a |

## Deferred Findings
None yet.

## Root Causes
1. HTTP transport hardening is split across handshake, client URL validation, and server request parsing, leaving security-sensitive checks as local conventions instead of shared invariants.
