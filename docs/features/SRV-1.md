# SRV-1: Sidecar `server.ts`, stdio NDJSON router, and route modules

**Story**: Replace the sidecar stub with a **stdio NDJSON** server that maps each inbound message **`type`** to a **route handler**, opens the SQLite database **lazily on first use** ([ADR-004](../decisions/ADR-004-per-vault-index-storage.md)), runs a **background queue worker** after `index/full` and `index/incremental`, and emits **progress push lines** on stdout for `IndexProgressEvent` (shape compatible with [README API Contract](../../README.md#sidecar-message-protocol)).
**Epic**: 7 — Sidecar server, routes, and observability
**Size**: Large
**Status**: Open

---

## 1. Summary

[ADR-006](../decisions/ADR-006-sidecar-architecture.md) requires the same logical API over stdio and HTTP; this story delivers the **stdio framing** and **message router**. The plugin (PLG-2) will spawn the sidecar and write one JSON object per line; the sidecar writes **response lines** and **push lines** (progress) per the protocol below.

**Lazy DB:** Opening `better-sqlite3`, relational migrations, and sqlite-vec schema must not run at process start—only when the first handler needs `IDocumentStore` ([README §15](../../README.md#15-startup-performance), ADR-004).

**Indexing:** [IncrementalIndexPlanner](../../src/core/workflows/IncrementalIndexPlanner.ts) enqueues work; a **single serialized worker loop** dequeues and calls [`processOneJob`](../../src/core/workflows/IndexWorkflow.ts). Each enqueued job carries a **`runId`** (extend [`NoteIndexJob`](../../src/core/domain/types.ts)) so `job_steps` / progress correlation matches the client’s `runId` in `IndexRunAck`.

**Providers:** Use [`createEmbeddingPort`](../../src/sidecar/adapters/createEmbeddingPort.ts) and [`createChatPort`](../../src/sidecar/adapters/createChatPort.ts) with configuration from **environment variables** (PLG-1/4 will pass them when spawning): `OBSIDIAN_AI_EMBEDDING_PROVIDER`, `OBSIDIAN_AI_EMBEDDING_BASE_URL`, `OBSIDIAN_AI_EMBEDDING_MODEL`, `OBSIDIAN_AI_CHAT_PROVIDER`, `OBSIDIAN_AI_CHAT_BASE_URL`, `OBSIDIAN_AI_CHAT_MODEL`, plus `OBSIDIAN_AI_DB_PATH` (required for non–health-only calls), `OBSIDIAN_AI_EMBEDDING_DIMENSION`, `OBSIDIAN_AI_QUEUE_CONCURRENCY`, `OBSIDIAN_AI_MAX_RETRIES`.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Sidecar process; stdio NDJSON; vault/secrets boundaries. |
| [ADR-004](../decisions/ADR-004-per-vault-index-storage.md) | Lazy DB open; per-vault path from env. |
| [ADR-007](../decisions/ADR-007-queue-abstraction.md) | `InProcessQueue` + worker dequeue loop. |
| [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) | `JobStepService` + progress events. |
| [ADR-005](../decisions/ADR-005-provider-abstraction.md) | Embedding/chat only via ports/factories. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Stdio **stdout** carries **only** the NDJSON protocol (responses + pushes); **no** unstructured `console.log` to stdout in sidecar code paths used in production (use stderr for debug prints until SRV-4).
2. **Y2** — SQLite + migrations + vec schema open **only** inside lazy init triggered by the first request that needs the store/queue/job steps (not in `main()` before reading stdin).
3. **Y3** — **`src/core/`** must not import `better-sqlite3`, `fs` for DB paths, or route modules ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)).
4. **Y4** — **`NoteIndexJob`** includes **`runId: string`**; planner and all enqueue call sites set it; `processOneJob` uses **`job.runId`** for `jobSteps` / correlation (update tests).
5. **Y5** — Message **`type`** values match [README Sidecar Message Protocol](../../README.md#sidecar-message-protocol) (`index/full`, `index/incremental`, `index/status`, `search`, `chat`, `chat/clear`, `health`).
6. **Y6** — After `index/full` / `index/incremental` return `IndexRunAck`, a **background worker** continues until the queue has no **pending** items for this process (drain loop); progress emits on stdout as push lines.

---

## 5. API Endpoints + Schemas

No HTTP in this story. **Stdio NDJSON** (document as normative for PLG-2):

**Request line:** `{ "id": string, "type": SidecarRequest["type"], "payload": ... }` (omit `payload` if empty).

**Response line:** `{ "id": string, "type": <same as request type>, "body": <SidecarResponse body> }` for RPC types in [`SidecarResponse`](../../src/core/domain/types.ts).

**Error line:** `{ "id": string, "error": { "message": string, "code"?: string } }`.

**Push line (stdout):** `{ "channel": "push", "type": "progress", "event": IndexProgressEvent }`.

**Chat streaming (stdio):** For `type: "chat"`, after the request is accepted, emit one or more  
`{ "channel": "push", "requestId": string, "type": "chat", "chunk": ChatStreamChunk }`  
then a final `{ "id", "type": "chat", "done": true, "sources": Source[] }` (chat is not in `SidecarResponse` union—terminal line is framing-only).

---

## 6. Frontend Flow

Not applicable (sidecar only).

### 6a. Component / Data Hierarchy

```
(n/a)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| — | — | — | — |

### 6c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| — | — |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/stdio/ndjsonProtocol.ts` | Request/response line types + stringify helpers |
| 2 | `src/sidecar/stdio/stdioServer.ts` | Readline loop, dispatch, push writer |
| 3 | `src/sidecar/runtime/SidecarRuntime.ts` | Lazy deps: db, store, queue, jobSteps, progress, worker |
| 4 | `src/sidecar/routes/*.ts` | Per-type handlers (or single `dispatch.ts`) |
| 5 | `src/sidecar/stdio/stdioServer.test.ts` | Protocol + lazy open smoke |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/sidecar/server.ts` | Entry: start stdio server |
| 2 | `src/core/domain/types.ts` | Add `runId` to `NoteIndexJob` |
| 3 | `src/core/workflows/IncrementalIndexPlanner.ts` | Require `runId` on input; set on jobs |
| 4 | `src/core/workflows/IndexWorkflow.ts` | Use `job.runId` in `processOneJob` |
| 5 | `src/core/workflows/*.test.ts` / `JobStepService.test.ts` | Jobs include `runId` |

### Files UNCHANGED (confirm no modifications needed)

- `src/plugin/**` — PLG-2 wires stdio client later.

---

## 8. Acceptance Criteria Checklist

### Phase A: Protocol + routing

- [ ] **A1** — A valid `{id,type:'health'}` line produces a response line with `body.status === 'ok'` and numeric `uptime` without opening SQLite (no file at dummy path required).
  - Evidence: `src/sidecar/stdio/stdioServer.test.ts::A1_health_without_db(vitest)`

- [ ] **A2** — Unknown `type` yields an error line with the same `id` and a non-empty `error.message`.
  - Evidence: `src/sidecar/stdio/stdioServer.test.ts::A2_unknown_type_error(vitest)`

### Phase B: Lazy database

- [ ] **B1** — First `index/status` (or `search`) with valid `OBSIDIAN_AI_DB_PATH` triggers `openDatabase` exactly once; second call reuses the same connection (assert with spy or counter in test module).
  - Evidence: `src/sidecar/runtime/SidecarRuntime.test.ts::B1_lazy_open_once(vitest)`

### Phase C: Index enqueue + worker

- [ ] **C1** — `index/full` with in-memory or temp DB path enqueues jobs whose payloads include `runId` matching the ack `runId`, and `noteCount` equals enqueued count; worker runs `processOneJob` to completion for a tiny fixture (fake embed/chat or existing test fakes in sidecar tests).
  - Evidence: `src/sidecar/stdio/stdioServer.test.ts::C1_index_full_enqueue_and_drain(vitest)` or `src/sidecar/runtime/SidecarRuntime.test.ts`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `npm run verify:core-imports` passes; no new `src/core` imports of `better-sqlite3` or sidecar routes.
  - Evidence: `npm run verify:core-imports`

- [ ] **Y2** — **(binding)** `NoteIndexJob` in `src/core/domain/types.ts` requires `runId`; `rg "NoteIndexJob"` in core shows updated struct literals in tests/planner.
  - Evidence: `npm run typecheck` + `src/core/workflows/IncrementalIndexPlanner.test.ts` updated

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — **N/A** (no shared package; plugin unchanged)
- [ ] **Z5** — Errors and significant operations log or surface structured messages (stderr acceptable until SRV-4)

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Stdio chat streaming interleaving | Document `requestId` on push lines; single-threaded Node writes lines atomically. |
| 2 | Concurrent index runs | MVP: one worker; jobs tagged with `runId`; optional future mutex per vault. |

---

## Implementation Order

1. `types.ts` + `IncrementalIndexPlanner` + `IndexWorkflow` + tests — `runId` plumbing (**Y2**, **C1**).
2. `SidecarRuntime.ts` — lazy open, factories, progress collector → push callback.
3. `stdioServer.ts` + `server.ts` — loop + dispatch (**A1**, **A2**, **C1**).
4. Tests (**A1–C1**, **B1**).
5. **Verify** — `npm run verify:core-imports`, `npm run build`, `npm test`.

---

*Created: 2026-04-05 | Story: SRV-1 | Epic: 7 — Sidecar server, routes, and observability*
