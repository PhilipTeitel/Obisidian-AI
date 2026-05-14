# Code Review — Obsidian AI Plugin

**Reviewer:** AI-assisted code review (May 2026)
**Scope:** Security & secrets handling, code structure & hexagonal boundaries, test quality (with focus on cryptic test names).
**Depth:** Deep dive on highest-risk areas — workflows, sidecar transport, secret handling, agent tools, test suite. The rest skimmed.
**Codebase snapshot:** ~10.4K LOC source / ~13.8K LOC tests across 84 source and 99 test files. Plugin + Node sidecar architecture.

---

## TL;DR

Overall this is a well-organized hexagonal codebase with strong boundary discipline, good ADR/traceability practice, and rigorous strict-mode TypeScript. The most important things to fix, in order:

1. **Session token leaks on stderr** — The HTTP session token is `process.stderr.write`-ed at startup so the parent plugin can read it (`src/sidecar/server.ts:47`). Stderr can be captured by anything downstream (logs, dev tools, support-bundle exports). Hand it over a private channel instead.
2. **No `Origin` check on the WebSocket upgrade** — `src/sidecar/http/httpServer.ts:53-74` accepts any origin as long as the bearer/query token matches. Combined with the token being accepted in the URL query (where it's prone to leaking into logs and `Referer` headers), a malicious page running in a browser on the same host has a non-trivial attack surface. Add an `Origin` allow-list and reject the query-string token form.
3. **Test names are dominated by spec-trace codes (`A1_…`, `Y5_…`, `S8`) rather than behavior.** 46 tests start with `A1_`, 40 with `B1_`, 40 with `A2_`, and so on (full count below). The prefixes do encode real traceability to AC IDs in `docs/features/*.md`, which is genuinely valuable — but they should live as suffixes/parentheticals, not as the load-bearing words of the test name. Worst offender: `it('C2_shared_retrieval_helper_S5')` in `tests/core/workflows/ChatWorkflow.coarseK.test.ts:40`, which also asserts `String(runChatStream).toContain('runSearch')` — a source-code stringification test that will silently rot.
4. **`ChatWorkflow.runChatStream` (192-line generator) and `SqliteDocumentStore` (537 lines, ~22 methods) are concentration risks.** Both are testable today only with deep mock setups; both would benefit from splitting orchestration from operation.
5. **Boundary script has a gap.** `scripts/check-source-boundaries.mjs` blocks `obsidian` and `better-sqlite3` from `src/core`, but not `node:*`, `fs`, `pino`, or `ws`. Core does in fact stay clean today, but the guardrail isn't enforcing what its docstring claims.

The rest of the review expands on these and adds the smaller findings.

---

## 1. Security findings

### S-1 (High) — HTTP session token written to `stderr` at startup
**Where:** `src/sidecar/server.ts:47-48`
```ts
process.stderr.write(`OBSIDIAN_AI_SESSION_TOKEN=${token}\n`);
process.stderr.write(`OBSIDIAN_AI_HTTP_URL=http://127.0.0.1:${port}\n`);
```
The plugin reads stderr to grab the token, but the same stream is what Obsidian surfaces in the dev console (`src/plugin/client/SidecarLifecycle.ts:372` mirrors stderr to `console.error`). Anyone shipping `console` output in a bug report — including all "share Obsidian console" support flows — exports the live token. A token rotation is needed on every Obsidian restart, but the steady-state risk during a session is real.

**Fix:** Hand the token over a private channel: write it to a `chmod 600` temp file under the OS user dir, or use the existing stdio handshake (the sidecar already supports stdio mode), or read a token the plugin generated and passed via env. Whichever you pick, stop printing it to stderr and stop logging the URL.

### S-2 (High) — No `Origin` check on the WebSocket upgrade; token accepted in URL query
**Where:** `src/sidecar/http/httpServer.ts:53-74`
```ts
const qToken = url.searchParams.get('token')?.trim();
const bearer = readBearer(req);
const ok = (qToken && qToken === token) || (bearer && bearer === token);
if (!ok) { socket.destroy(); return; }
```
Two compounding issues:
- The bound address is `127.0.0.1` (good — line 76) but the upgrade accepts requests from any `Origin`. A malicious webpage in the user's browser can attempt to open `ws://127.0.0.1:<port>/ws?token=…` from any origin. The token (UUID v4 — 122 bits of entropy) is the only barrier; there's no defense in depth.
- The token is accepted **as a query parameter**, which is the wrong place for a secret. Query strings end up in proxy logs, terminal/HTTP server access logs, browser history, and `Referer` headers. They're also visible to anyone with `lsof`/`netstat`-level access to live URLs.

**Fix:** Require `Authorization: Bearer …` on the upgrade — remove the `qToken` path entirely. Additionally, reject the upgrade if `req.headers.origin` is set and not in a small allow-list (you can use `null` / the loopback origins your plugin actually produces). The REST handler at line 90-94 already does Bearer-only correctly; make WS match.

### S-3 (Medium) — API key transmitted per-request in `payload.apiKey`
**Where:** `src/sidecar/runtime/SidecarRuntime.ts:295, 325, 404` (and the `payload` typing in `src/core/domain/types.ts`)
The OpenAI key is read from Obsidian's `app.secretStorage` (good — `src/plugin/settings/secretSettings.ts:6`) but then included on every chat/index payload sent to the sidecar. The sidecar is the same user's child process, so over stdio this is roughly equivalent to passing it as env — fine. Over HTTP it's still on `127.0.0.1` and Bearer-protected, so also acceptable.

The real risk is **logging surface area**: as long as `apiKey` rides on the payload, one bad `log.debug({ payload })` ships the key to wherever logs end up. The current debug logs at `SidecarRuntime.ts:375-386` are careful to pluck only safe fields, but there's no structural guarantee.

**Fix (defense in depth, pick one):** Either (a) pass the key once at sidecar boot (env var, handshake, or an explicit `setProviderKey` op) and drop the field from per-request payloads, or (b) keep per-request but add a pino redaction layer (`redact: ['*.apiKey', 'payload.apiKey']`) so it's structurally unloggable. Option (b) is the smaller change.

### S-4 (Medium) — OpenAI/Ollama adapters log response status + URL on failure
**Where:** `src/sidecar/adapters/OpenAIChatAdapter.ts:77`, `OpenAIEmbeddingAdapter.ts:60`
`console.warn` includes the URL of the request and the truncated response body. OpenAI error responses can contain request IDs and contextual fields that aren't secret per se but are unnecessary on stdout. Also: these use the global `console`, bypassing the sidecar's pino logger entirely.

**Fix:** Route through the sidecar's pino logger and log only `{ status, provider, durationMs }`. Drop the body.

### S-5 (Medium) — `console.*` is the primary logger in the plugin and in core workflows
**Where:** `src/core/workflows/SearchWorkflow.ts:312, 317`, `src/core/workflows/SummaryWorkflow.ts:170/180/189/231/246/253/291`, `src/core/workflows/IncrementalIndexPlanner.ts:75`, `src/plugin/client/SidecarLifecycle.ts:354/368/372/376`, `src/plugin/commands/registerCommands.ts:32`, etc.
Core workflows reach for the global `console` instead of an injected logger port. This is both a layering smell (core shouldn't depend on a global side effect) and a security smell — it makes it harder to centrally redact secrets, and Obsidian users sharing their console will include all of this.

**Fix:** Add an `ILoggerPort` to `src/core/ports/` and inject it the same way other ports are injected. Replace `console.*` calls in core. In the plugin, gate `console.log` calls behind a debug flag.

### S-6 (Medium) — No `Origin` / pinned-host check on the HTTP routes either
**Where:** `src/sidecar/http/httpServer.ts:90-94`
Bearer auth is enforced, but the same DNS-rebinding / browser-origin concern as S-2 applies (a malicious page can attempt to issue requests via `fetch()` to `http://127.0.0.1:PORT/chat`; preflight will gate it but only because the Authorization header is non-simple). Adding an `Origin` allow-list is cheap insurance.

**Fix:** Reject any HTTP request whose `Origin` is set and not in the allow-list.

### S-7 (Low) — Path-glob regex compilation has unbounded `**` expansion
**Where:** `src/core/domain/pathGlob.ts:15-40`
`**` → `.*` and `**/*` → `(?:.*/)*[^/]*`. The latter is a classic catastrophic-backtracking shape (nested quantifiers) but only against pathological inputs. In practice the matched strings are bounded vault paths so this is unlikely to be exploitable, and a user attacking themselves is the threat model. Still: a malicious vault note path or a typo'd settings glob could spin a CPU.

**Fix:** Either cap input length (`if (raw.length > 256) throw`) or count `**` segments (`if ((raw.match(/\*\*/g)?.length ?? 0) > 4) throw`).

### S-8 (Low) — Sidecar startup logs leak Node path + script path to Obsidian console
**Where:** `src/plugin/client/SidecarLifecycle.ts:354-368`
Information disclosure — not a secret per se, but a steady-state noise tax that ends up in user-submitted bug reports.

**Fix:** Demote to `log.debug` behind a setting.

### What looked clean (security)
- SQL is parameterized throughout `SqliteDocumentStore` (`db.prepare(...).all(...)` with bound params). The `fts-sanitize` module exists specifically because FTS5 MATCH expressions can't be parameterized cleanly, and the tokenizer + 64-term cap (`src/core/domain/fts-sanitize.ts:8`) is the right shape.
- HTTP server binds to `127.0.0.1` explicitly (`httpServer.ts:76`).
- Token is `randomUUID()` (122 bits) — strong enough.
- Agent note paths are validated against `..` traversal and an allow-list (the structure agent confirmed `validateAgentPath` in the agent tool runner).
- Grounding policy is versioned (`src/core/domain/groundingPolicy.ts`), which mitigates prompt-injection-via-note-content risk somewhat — the system prompt forces vault-only answers.
- No `child_process.exec`/`spawn` accepting user-controlled strings.

---

## 2. Code structure findings

### C-1 (High) — Boundary check script enforces a narrower invariant than it claims
**Where:** `scripts/check-source-boundaries.mjs:29`
```js
const corePatterns = [/from\s+['"]obsidian['"]/, /better-sqlite3/];
```
The script blocks two specific imports but not `fs`, `path`, `node:*`, `pino`, `ws`, or `electron`. Core currently happens to stay clean of these, but the script is the only guardrail and it's not actually guarding. A future "quick fix" that adds `import { readFileSync } from 'node:fs'` to a domain module will pass CI silently.

**Fix:** Extend `corePatterns` to forbid `from\s+['"]node:`, `from\s+['"]fs['"]`, `from\s+['"]path['"]`, `from\s+['"]pino['"]`, `from\s+['"]ws['"]`. Same script could also assert "every file in `src/core/ports/` is imported by at least one file in `src/core/workflows/` or `src/sidecar/` or `src/plugin/`" to catch dead ports.

### C-2 (Medium) — `ChatWorkflow.runChatStream` is a 192-line generator mixing six concerns
**Where:** `src/core/workflows/ChatWorkflow.ts:218-409` (file is 409 lines total)
The single generator handles: NL-date resolution, planner invocation, agentic tool execution, retrieval, synthesis/grounding validation, and streaming. The branch density (conditionals at ~263, 278, 288, 307, 363) makes the unit-test matrix combinatorial — which is why the test suite has separate files for `coarseK`, `hybrid`, `agentic`, `nlDateRetrievalQuery`, `insufficientEvidence`, `synthesis`, `dateRange`, `filters`, `userPrompts`, `sources`, and a base file. Each test reaches in with a stub at a slightly different layer.

**Fix:** Split `runAgenticChat(deps, messages, opts, dateRange, pathGlobs)` and `runRetrievalChat(deps, messages, opts, dateRange, pathGlobs)` as separate generators. Keep `runChatStream` as a thin orchestrator that resolves dates + globs and dispatches. The existing tests stay mostly intact and become much sharper because each can target the relevant sub-generator.

### C-3 (Medium) — `SqliteDocumentStore` is 537 lines of mixed query construction and execution
**Where:** `src/sidecar/adapters/SqliteDocumentStore.ts`
Implements 18 `IDocumentStore` methods plus helpers. `searchSummaryVectors` (310-333) and `searchContentVectors` (364-413) share most of their WHERE-clause construction; the per-method version drifts subtly (different filter precedence). The class is hard to unit-test without spinning up an in-memory SQLite.

**Fix:** Extract a private `buildSearchClauses(filter): { where: string; params: unknown[] }` helper used by both methods; alternatively introduce a tiny `SqlQueryBuilder` so the two `search*Vectors` methods read as ~10 lines each.

### C-4 (Medium) — Core uses global `console`; no `ILoggerPort`
(See S-5 above — same finding, structural lens.) The "no Node deps in core" invariant claimed by the boundary script would naturally include `console`. Today core depends on Node's global logger and there's no port for it.

**Fix:** Introduce `src/core/ports/ILoggerPort.ts` with `info`/`warn`/`error`/`debug` (4 methods). Plugin adapts to Obsidian's `Notice` + console; sidecar adapts to pino. This kills S-5 and C-4 in one move and lets the sidecar's existing pino redaction config govern core too.

### C-5 (Medium) — Stdio dispatcher does an unsafe double `unknown` cast
**Where:** `src/sidecar/stdio/stdioServer.ts:59`
```ts
const p = payload as unknown as Extract<SidecarRequest, { type: 'chat' }>['payload'];
```
The validation a few lines earlier checks `payload` is an object with a `messages` array — but `apiKey`, `coarseK`, `tags`, `pathGlobs`, etc. are all unchecked. If the plugin and sidecar disagree on the payload shape (e.g. after a version upgrade), this casts a malformed message into the workflow and the failure surfaces deep in chat code.

**Fix:** Add a `isChatStreamPayload(p): p is ChatStreamPayload` guard, or use zod/valibot for a small parse step at the transport boundary. Same applies to the other request types unmarshaled at the transport layer.

### C-6 (Medium) — Core workflows lack a typed error model
**Where:** All of `src/core/workflows/*.ts`
Errors propagate as raw `Error` or whatever upstream threw. There's no `WorkflowError` carrying a `phase`, `retryable`, or `cause`. Sidecar HTTP returns `{ error: { message } }` to the plugin, which then shows it raw to the user via `showAiNotice`. Two consequences: (a) users see "fetch failed" with no actionable context, (b) there's no telemetry hook for retryable vs terminal failures.

**Fix:** Add `class WorkflowError extends Error { phase; retryable; cause }` in `src/core/domain/`. Wrap port calls in workflows. The HTTP error path can then return a typed body and the plugin's `showAiNotice` can format friendlier strings.

### C-7 (Low) — Settings UI is a 483-line declarative-by-imperative method
**Where:** `src/plugin/settings/SettingsTab.ts`
46+ `new Setting(...).setName(...).addText(...).onChange(...)` chains inline. Validation rules and persistence are tangled into each callback. Hard to unit-test validation independently.

**Fix:** Define a settings schema array (`{ key, label, type, validate, placeholder }[]`) and iterate. The chain becomes a `renderSetting(schema, container)` helper. Validation can be tested without an Obsidian container.

### C-8 (Low) — Five tsconfigs and two esbuild configs with substantial overlap
**Where:** `tsconfig*.json`, `esbuild.config.mjs`, `esbuild.sidecar.mjs`
The separate tsconfigs each extend `tsconfig.json` with one or two flags. Esbuild configs duplicate the bundle/format/target setup.

**Fix:** Use TS project references with one `tsconfig.json` at the root and per-layer leaf configs that only declare `references` + minimal overrides. For esbuild, hoist the common config into a `buildLayer({ entry, platform, format })` helper called twice.

### C-9 (Low) — `IVaultAccessPort` is exported from core but consumed only by the plugin
**Where:** `src/core/ports/IVaultAccessPort.ts`, `src/core/ports/index.ts`
No core workflow imports it. It belongs in `src/plugin/ports/` (and the plugin's `main.ts` should wire it in), or its presence in core should be justified by a comment pointing to the future workflow that will use it.

**Fix:** Move to `src/plugin/ports/` (if it's only ever a plugin-side port) or add a `// TODO(<feature>): consume from <workflow>` comment with an ADR link.

### C-10 (Low) — `coarseK` and the "K" naming family lack inline documentation
**Where:** `src/core/workflows/SearchWorkflow.ts:44, 190`, `src/core/workflows/ChatWorkflow.ts` references
"coarseK" refers to the size of the first-phase summary embedding result set per ADR-012. The acronym is well-defined in docs/decisions and in `docs/features/RET-4.md`, but a new contributor reading `coarseK: 40` in code has no breadcrumb. The same critique applies to "summaryK", "contentK", "fallbackFloor".

**Fix:** A JSDoc on the `SearchOptions` type with one-line definitions and a link to ADR-012 would cover it. Don't rename — the existing names are consistent with the docs.

### C-11 (Low) — `Ollama*Adapter` accepts an `apiKey` parameter only to `void` it
**Where:** `src/sidecar/adapters/OllamaChatAdapter.ts:36`, `OllamaEmbeddingAdapter.ts:31`
The unused parameter signals "this interface forces me to take a key I'll throw away." If Ollama starts requiring auth (it can now), the discard is a footgun.

**Fix:** Split the chat/embedding port into "auth-required" and "auth-optional" variants, or pass `auth?: { apiKey: string }` and have Ollama no-op when absent.

### What's done well (structure)
- Strict-mode TypeScript, near-zero `any`, no `@ts-ignore`/`@ts-expect-error`.
- Port interfaces are appropriately small (`IEmbeddingPort` has one method, `IChatPort` has one method) — no god-interfaces.
- No `TODO`/`FIXME`/`HACK` markers in `src/` at all — a striking sign of finished work, though it does mean known limitations live only in heads.
- ADR + feature-doc traceability is the strongest aspect of the project (`docs/decisions/`, `docs/features/`).
- Test runner setup (Vitest) and the `tests/contract`, `tests/integration`, mirrored `tests/{core,plugin,sidecar}` layout are textbook.
- Verification scripts (`check-source-boundaries`, `check-core-imports`, `verify-chat-prompt-transport`, `verify-stack`, `verify-plugin-bundle`) demonstrate real architectural intent.

---

## 3. Test quality findings

### T-1 (High) — Spec-trace prefixes have hijacked the test names
**Where:** Across `tests/core/workflows/` and `tests/core/domain/`. Counts from `grep -ohE "it\\(['\"][A-Z][0-9]+_" tests/`:
```
46 it('A1_      40 it('B1_      40 it('A2_
34 it('B2_      26 it('A3_      24 it('C1_
19 it('Y2_      19 it('B3_      15 it('C2_
14 it('Y1_      14 it('A4_      11 it('B4_
 9 it('Y8_       9 it('Y5_       8 it('Y4_
```
These prefixes are real — they trace to AC IDs in `docs/features/*.md` (e.g. `RET-4.md` §4 lists `Y1`, `Y2`, …, and §8a maps Gherkin scenarios `S1`–`S10`). That's genuinely valuable. The problem is they're the **first thing** in the test name, so the test reads as `'C2_shared_retrieval_helper_S5'` rather than `'shares the retrieval helper between chat and search (C2 / S5)'`.

Concrete worst cases:
- `tests/core/workflows/ChatWorkflow.coarseK.test.ts:40` — `it('C2_shared_retrieval_helper_S5', …)`
- `tests/core/workflows/ChatWorkflow.coarseK.test.ts:59` — `it('Y5_empty_after_fallback_keeps_grounding_S8', …)`
- `tests/core/domain/rrf.test.ts:7` — `it('B1_fused_order_deterministic', …)`
- `tests/core/domain/fts-sanitize.test.ts:5` — `it('A1_basic_tokens_or_joined', …)`
- `tests/core/workflows/ChatWorkflow.hybrid.test.ts:17` — `it('C7_chat_shares_retrieval_helper_and_toggle', …)`
- `tests/core/workflows/SummaryWorkflow.rubric.test.ts:143` — `it('A1_note_uses_rubric', …)`
- `tests/core/workflows/ChatWorkflow.agentic.test.ts:135` — `it('A1_accepts_planner_and_tool_ports', …)`

**Fix:** Keep the traceability codes — they have value — but invert the order. Pattern:
```
it('<plain English behavior in present tense> (Y5 / S8)', …)
```
A focused find-and-replace pass covers most of them in a couple of hours. The renaming table below has 15 worked examples; the rest follow the same shape.

### T-2 (High) — One test asserts on the source-code string of the function
**Where:** `tests/core/workflows/ChatWorkflow.coarseK.test.ts:41`
```ts
expect(String(runChatStream)).toContain('runSearch');
```
This asserts that the *text* of the chat workflow generator literally contains the identifier `runSearch`. The intent is to enforce "chat goes through the shared retrieval helper" (a real, important invariant — see ADR-012 Decision 6), but the implementation is brittle:
- Rename `runSearch` → break the test even though behavior is fine.
- Inline `runSearch` at the call site (legitimate refactor) → break the test.
- Wrap `runSearch` in `withTelemetry(runSearch)` → still passes despite real change.

It's also the only meaningful assertion in this `it` block (the rest of the body just calls into `runSearch` and asserts unrelated things).

**Fix:** Replace with a behavioral assertion: spy on the shared `searchSummaryVectors` port method during a chat call and verify it was invoked with `coarseK=40`. The next test block (`Y5_…`) already does this kind of behavioral check correctly — copy that pattern.

### T-3 (Medium) — `describe` blocks are flat; the spec-trace prefix is the only grouping
**Where:** Most files in `tests/core/workflows/`
Each test file uses a single `describe('Foo (REQ-???)')` with 5–15 `it` blocks underneath. Logically related tests (e.g. "happy path", "fallback fires", "fallback empty") aren't nested. Combined with the cryptic prefixes, scrolling output makes it hard to see the structure.

**Fix:** Add one level of nesting:
```ts
describe('SearchWorkflow coarse-K + fallback (RET-4)', () => {
  describe('coarseK option threading', () => { /* A1, A2 */ });
  describe('fallback below floor', () => { /* B1, B2, B3 */ });
  describe('empty after fallback (no-regression)', () => { /* Y5 */ });
});
```

### T-4 (Medium) — Several missing edge-case tests in critical workflows
Reading each workflow against its test:
- `SummaryWorkflow.ts` — no test for malformed `dailyNoteDatePattern` (parser failure). `dailyNoteDate.ts` has unit tests, but the wired-up failure mode isn't covered at the workflow level.
- `IndexWorkflow.ts` — no test for embedding dimension mismatch (config says 1536, model returns 768). Real failure mode for users mixing providers.
- `IndexWorkflow.ts` — no test for very large notes (10K+ lines) chunking the way the configured budget expects.
- `ChatWorkflow.ts` — no test for sidecar disconnect mid-stream in agentic mode. (`ChatWorkflow.test.ts:123-135` tests abort/timeout on `complete()`, but not partial-stream-then-disconnect.)
- `ChatWorkflow.ts` — no test for LLM rate-limit / 429 with the existing retry/backoff (or confirmation that none is intended).
- `AgentNoteToolRunner.ts` — no test for circular tool-call loops (planner asks to re-run the same tool with identical args N times); confirm there's a max-step guard.

**Fix:** Add one test per row above. Each is cheap; together they cover the failure modes a user actually hits.

### T-5 (Medium) — Duplicated test fixtures (`seedNode`, `fakeEmbed`, `fakeChat`) across files
**Where:** `tests/core/workflows/ChatWorkflow.agentic.test.ts:22-28`, `tests/core/workflows/AgentNoteToolRunner.test.ts:9-15`, `tests/integration/agent-note-tools.integration.test.ts:9-15`, and at least 5 more files.
Each has its own copy of `seedNode({...})` factories and trivially-different `fakeEmbed` / `fakeChat` doubles. Updating the `NodeRecord` shape requires editing every copy.

**Fix:** Promote to `tests/fixtures/` (alongside the existing `tests/shims/`). Use a `makeNode(overrides?)` factory and a `fakeEmbed({ dim?, value? })` builder.

### T-6 (Medium) — Contract tests cover one adapter, but the contract is the point
**Where:** `tests/contract/` + `tests/sidecar/adapters/IDocumentStore.*.contract.test.ts`
The contract assertions (`assertPromptVersionRoundTrip`, `assertUnrestrictedContentSearchContract`) are well-shaped — they're parametric in the store. But they're invoked against only `SqliteDocumentStore`. There's no `InMemoryDocumentStore` (used in unit tests as `SearchTestStore`) verified against the same contract, so when those in-memory doubles drift from real behavior, unit tests pass while integration fails.

**Fix:** Run each contract against both the real adapter (today) and the in-memory test double (`SearchTestStore`). Forces the double to stay honest.

### T-7 (Low) — A handful of "mock theater" assertions
**Where:** e.g. `tests/core/workflows/ChatWorkflow.agentic.test.ts:148-152`
```ts
expect(planner.inputs).toHaveLength(1);
expect(tools.calls).toHaveLength(1);
expect(chat.calls).toHaveLength(1);
```
Three counts, no argument checks. The same file does `toMatchObject(...)` correctly elsewhere (line 204), so the pattern is known — these spots are inconsistent.

**Fix:** Pair each `toHaveLength` with at least one `toMatchObject` against the first call's args.

### T-8 (Note) — Integration tests are "bigger unit tests"
`tests/integration/` exercises real domain + real SQLite in-memory, but **mocks the transport** — no actual sidecar process is spawned, no real HTTP/stdio. That's a legitimate trade-off for speed, but it means there's no automated check that the plugin↔sidecar wire shape matches end-to-end. The `verify-stack.mjs` script may cover this; if not, an opt-in `npm run test:e2e` that spawns the sidecar for one happy-path chat would close the gap.

### What's done well (tests)
- Test count is healthy (~99 files, 13.8K LOC) and the layering mirrors `src/`.
- `tests/integration/agent-note-tools.integration.test.ts` exercises the real `AgentNoteToolRunner` against a real in-memory SQLite — this is the right shape.
- Each test file's intent (when you strip the prefixes) is clear: behavioral assertions, not snapshots.
- `tests/shims/obsidian.ts` is the right shape (one shared shim, not per-test).

---

## 4. Cryptic-name renaming table

These are concrete starting points. Each preserves the spec trace code as a suffix rather than removing it.

| File | Current `it(...)` name | Suggested |
|------|------------------------|-----------|
| `tests/core/workflows/ChatWorkflow.coarseK.test.ts:40` | `'C2_shared_retrieval_helper_S5'` | `'chat routes retrieval through the same helper as search (C2 / S5)'` — and replace the source-string assertion with a behavioral one |
| `tests/core/workflows/ChatWorkflow.coarseK.test.ts:59` | `'Y5_empty_after_fallback_keeps_grounding_S8'` | `'keeps grounding active when coarse and fallback both return empty (Y5 / S8)'` |
| `tests/core/workflows/SearchWorkflow.coarseK.test.ts:20` | `'A1_respects_coarseK_S1_S2'` | `'passes coarseK through to summary vector search (A1 / S1, S2)'` |
| `tests/core/workflows/SearchWorkflow.coarseK.test.ts:49` | `'A2_default_32_S6'` | `'uses DEFAULT_COARSE_K (32) when caller does not specify (A2 / S6)'` |
| `tests/core/workflows/SearchWorkflow.coarseK.test.ts:62` | `'B1_fallback_fires_below_floor_S3'` | `'fires unrestricted content-vector fallback below the floor (B1 / S3)'` |
| `tests/core/workflows/SearchWorkflow.coarseK.test.ts:78` | `'B2_merge_dedup_S3'` | `'dedupes fallback hits against coarse results by nodeId (B2 / S3)'` |
| `tests/core/workflows/ChatWorkflow.hybrid.test.ts:17` | `'C7_chat_shares_retrieval_helper_and_toggle'` | `'honors enableHybridSearch from chat options end-to-end (C7)'` |
| `tests/core/workflows/SummaryWorkflow.rubric.test.ts:143` | `'A1_note_uses_rubric'` | `'applies the rubric template when summarizing a note (A1)'` |
| `tests/core/workflows/ChatWorkflow.agentic.test.ts:135` | `'A1_accepts_planner_and_tool_ports'` | `'wires planner and tool ports into the agentic chat path (A1)'` |
| `tests/core/domain/rrf.test.ts:7` | `'B1_fused_order_deterministic'` | `'produces deterministic fused order across input rank lists (B1)'` |
| `tests/core/domain/fts-sanitize.test.ts:5` | `'A1_basic_tokens_or_joined'` | `'joins tokenized terms with FTS5 OR operator (A1)'` |

The same transformation applies to the remaining ~330 `A1_` / `A2_` / `B1_` / `Y…_` named tests. A short refactor: write a script that reads each `it('<CODE>_<snake_case>'…)`, splits on `_`, capitalizes the first word, and appends `(<CODE>)`. Then hand-edit the ~40 that need real English. Worth doing in one PR.

---

## 5. Suggested action list (highest leverage first)

1. Stop printing the session token (and URL) to stderr — replace with a `chmod 600` temp file or env handshake (S-1).
2. Add an `Origin` allow-list to both the HTTP routes and the WS upgrade; remove the `?token=` query param path (S-2, S-6).
3. Introduce `ILoggerPort`; replace `console.*` in `src/core/workflows/*.ts` and `src/plugin/`; configure pino redaction (`apiKey`, `Authorization`) at the sidecar (S-3, S-4, S-5, C-4).
4. Tighten `scripts/check-source-boundaries.mjs` to block `node:*` / `fs` / `path` / `pino` / `ws` in `src/core` (C-1).
5. Split `runChatStream` into `runAgenticChat` + `runRetrievalChat` orchestrated by a thin top-level (C-2). Bonus: the test files for agentic/coarseK/hybrid become much sharper.
6. Renaming pass on tests — invert prefix order so behavior leads (T-1). Replace the `String(runChatStream).toContain('runSearch')` assertion with a behavioral one (T-2).
7. Add a `WorkflowError` with `phase` + `retryable`; thread through the HTTP error path (C-6).
8. Add missing edge-case tests: malformed daily-note date pattern, embedding dimension mismatch, sidecar mid-stream disconnect, agent tool max-step guard (T-4).

---

## 6. Things worth highlighting for an AI-assisted development demo

Since the goal is to demonstrate AI experience, two patterns in this codebase are unusually strong artifacts of good AI-collaboration practice:

- **ADR + feature-doc traceability is best-in-class.** The fact that test prefixes (`A1`, `Y5`, `S8`) trace back to specific acceptance-criteria IDs in `docs/features/*.md`, which in turn cite `docs/decisions/ADR-XXX.md`, is exactly the kind of paper trail that makes AI-assisted change-management trustworthy. The cryptic test names are actually a symptom of this strength; the fix is to preserve the trace and add prose, not to delete the codes.
- **Hexagonal boundaries are enforced by scripts, not aspiration.** `check-source-boundaries`, `check-core-imports`, `verify-chat-prompt-transport` — even imperfect, these are the right shape. AI-generated code drifts most where invariants live only in PR-review comments; this project promoted them to executable checks.

The biggest "tell" of AI-assisted output here is the test name pattern: an LLM happily produces 46 different `A1_…` tests because the prompt told it to map to AC IDs, and the prompt didn't say "also describe behavior in English." A simple convention change ("AC IDs go in parens at the end") and one renaming pass fixes ~330 tests permanently.
