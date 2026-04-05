# WKF-2: `IndexWorkflow` — queue-driven state machine (parse → store → summarize → embed)

**Story**: Implement **`IndexWorkflow`** in `src/core/workflows/IndexWorkflow.ts` that dequeues **`NoteIndexJob`** items from **`IQueuePort`**, drives **`JobStepService`** (via a new **`IJobStepPort`** in core) through ADR-008 steps, runs **`chunkNote`**, persists nodes/tags/cross-refs and metadata through **`IDocumentStore`**, invokes **`SummaryWorkflow`** (WKF-1) for the summarizing phase, then **`IEmbeddingPort`** for content and summary vectors with **idempotent skips** per [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md), emitting **`IProgressPort`** events only through the job-step layer (QUE-2).
**Epic**: 4 — Index, summary, and embedding workflows
**Size**: Large
**Status**: Open

---

## 1. Summary

This story is the **vertical slice** that turns discrete adapters (queue, SQLite store, embeddings, job steps) into a **single per-note pipeline** matching the README indexing state machine ([README §19](../../README.md#19-idempotent-indexing-state-machine)). The workflow is **port-only** in `src/core/`; the sidecar wires concrete adapters ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)).

**Pipeline steps (per note job):**

1. **`ensureJob`** / **`queued`** — `JobStepService.ensureJob` with `jobId`, `runId`, `notePath`, `contentHash` from payload.
2. **Parsing** — `transitionStep` to `parsing` → `chunkNote` → `parsed`.
3. **Storing** — `transitionStep` to `storing` → transactional write: `upsertNodes`, replace **tags** and **cross_refs** for the note, `upsertNoteMeta` → `stored`.
4. **Summarizing** — `transitionStep` to `summarizing` → `SummaryWorkflow` → `summarized` (failures → `markFailed` / nack per below).
5. **Embedding** — `transitionStep` to `embedding` → for each node, content vector: skip if `getEmbeddingMeta(nodeId,'content')?.contentHash === node.contentHash`; else `IEmbeddingPort.embed` + `upsertEmbedding`. Then summary vectors for non-leaves with summaries: skip if meta hash matches **summary text hash** Implementer defines (e.g. SHA-256 of summary string) or stored convention — **minimum:** skip when `embedding_meta.content_hash` equals hash of current summary text → `embedded`.

**Concurrency:** The workflow **does not** spawn threads; an outer driver (future sidecar indexer) calls `processNextBatch` or similar up to **`queueConcurrency`**. Each dequeue’d item is processed **sequentially** inside one worker invocation unless Implementer documents safe parallelism (default **sequential**).

**Failure handling:** On uncaught error after `ensureJob`, call **`markFailed`** with message, then **`IQueuePort.nack(queueItemId, reason)`** so QUE-1 retry / dead-letter applies. Align retry semantics with `JobStepService` (`failed` → `queued` on retry).

**Resume:** Expose **`resumeInterruptedJobs(deps)`** that calls `jobSteps.listRecoverableJobs()`, filters to jobs still relevant, and **re-enqueues** payloads (WKF-3 may refine filtering). Caller supplies `runId` for the new run when re-enqueueing.

**Prerequisites:** [QUE-1](QUE-1.md), [QUE-2](QUE-2.md), [STO-3](STO-3.md), [WKF-1](WKF-1.md) (`SummaryWorkflow` + store read APIs).

Pointers: [IQueuePort](../../src/core/ports/IQueuePort.ts), [IEmbeddingPort](../../src/core/ports/IEmbeddingPort.ts), [chunkNote](../../src/core/domain/chunker.ts).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-007](../decisions/ADR-007-queue-abstraction.md) | All work enters via `IQueuePort`; ack/nack after terminal or failure. |
| [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Step order, skips, crash recovery, progress correlation. |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Core workflow vs sidecar adapters; vault content arrives in payload. |
| [ADR-005](../decisions/ADR-005-provider-abstraction.md) | Embeddings via `IEmbeddingPort` only. |
| [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) | Chunk structure and note identity. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `IndexWorkflow` lives under `src/core/workflows/` and must **not** import `better-sqlite3`, `obsidian`, or concrete adapter classes from `src/sidecar/adapters/` (only port types from `src/core/ports/` and domain from `src/core/domain/`).
2. **Y2** — Every ADR-008 step transition goes through **`IJobStepPort`** methods that mirror **`JobStepService`** semantics (`ensureJob`, `transitionStep`, `markFailed`, `listRecoverableJobs`).
3. **Y3** — **`jobId`** and **`runId`** passed to job-step methods must match QUE-2 / README correlation (`jobId` format is product-defined; use `${runId}:${notePath}` in tests unless documented otherwise).
4. **Y4** — **`chunkNote`** is the **only** parser entry point for markdown → `ChunkNoteResult` (no duplicate markdown pipeline).
5. **Y5** — **Tags** and **cross_refs** from `ChunkNoteResult` must be persisted in the same logical “store” phase as nodes: **delete prior rows for the note** then insert fresh (FK to `nodes` ids), in a **transaction** with `upsertNodes` so orphans never appear.
6. **Y6** — Embedding skips must consult **`getEmbeddingMeta`** and compare **`contentHash`** to current node or summary text per ADR-008 §2.
7. **Y7** — Successful end-to-end processing for one note ends with **`transitionStep(..., 'embedded')`** and **`IQueuePort.ack(itemId)`**.

---

## 5. API Endpoints + Schemas

No HTTP routes (SRV-1 wires handlers later).

**New domain types** in [`src/core/domain/types.ts`](../../src/core/domain/types.ts):

```ts
/** Payload stored in `queue_items.payload` for indexing (JSON-serializable per QUE-1). */
export interface NoteIndexJob {
  /** Stable note primary key — use vault-relative path string for MVP (matches `note_meta.vault_path` / chunker `noteId`). */
  noteId: string;
  vaultPath: string;
  noteTitle: string;
  markdown: string;
  contentHash: string;
}
```

**New port** [`src/core/ports/IJobStepPort.ts`](../../src/core/ports/IJobStepPort.ts):

```ts
import type { IndexStep, JobStep } from '../domain/types.js';

export interface IJobStepPort {
  ensureJob(input: {
    jobId: string;
    runId: string;
    notePath: string;
    contentHash: string;
  }): void;

  transitionStep(input: {
    jobId: string;
    runId: string;
    to: IndexStep;
    detail?: string;
  }): void;

  markFailed(input: { jobId: string; runId: string; message: string }): void;

  listRecoverableJobs(): JobStep[];
}
```

**`JobStepService`** in sidecar **implements `IJobStepPort`** (add `implements` clause; methods remain sync — workflow may wrap in `Promise.resolve` for uniform async API if desired).

**IndexWorkflow** (illustrative):

```ts
export interface IndexWorkflowDeps {
  queue: IQueuePort<NoteIndexJob>;
  store: IDocumentStore;
  embed: IEmbeddingPort;
  chat: IChatPort;
  jobSteps: IJobStepPort;
  /** Model labels / settings from caller */
  embeddingModel: string;
  embeddingDimension: number;
  chatModelLabel: string;
}

export async function processOneJob(
  deps: IndexWorkflowDeps,
  ctx: { runId: string; apiKey?: string },
  item: QueueItem<NoteIndexJob>,
): Promise<void>;
```

Add **`replaceNoteTags(noteId: string, tags: ParsedTag[]): Promise<void>`** and **`replaceNoteCrossRefs(noteId: string, refs: ParsedCrossRef[]): Promise<void>`** (or one `upsertChunkArtifacts` method) to **`IDocumentStore`** — Implementer chooses naming; behavior = replace per note.

**Hash for summary embedding skip:** Add small pure helper `hashText(s: string): string` (reuse `@noble/hashes` like chunker) for `EmbedMeta.contentHash` on summary vectors.

---

## 6. Frontend Flow

Not applicable.

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/ports/IJobStepPort.ts` | Core-facing job step contract. |
| 2 | `src/core/workflows/IndexWorkflow.ts` | State machine + orchestration. |
| 3 | `src/core/workflows/IndexWorkflow.test.ts` | Fakes for all ports; step + queue assertions. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | Add `NoteIndexJob`. |
| 2 | `src/core/ports/IDocumentStore.ts` | Add tag/xref replace methods for a note. |
| 3 | `src/core/ports/index.ts` | Export `IJobStepPort`. |
| 4 | `src/sidecar/adapters/SqliteDocumentStore.ts` | Implement tag/xref replace (transactional with nodes). |
| 5 | `src/sidecar/adapters/SqliteDocumentStore.test.ts` | Tests for tag/xref replace. |
| 6 | `src/sidecar/adapters/JobStepService.ts` | `implements IJobStepPort`. |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/adapters/InProcessQueue.ts` — no semantic change; WKF-2 consumes as-is.
- `src/core/ports/ISidecarTransport.ts` — index HTTP mapping is SRV-1.

---

## 8. Acceptance Criteria Checklist

### Phase A: Store extensions for chunk artifacts

- [ ] **A1** — After `upsertNodes` for a note, `replaceNoteTags` / `replaceNoteCrossRefs` (or combined API) persist all `ParsedTag` / `ParsedCrossRef` rows; re-running with empty arrays clears prior rows for that note.
  - Evidence: `src/sidecar/adapters/SqliteDocumentStore.test.ts::A1_tags_xrefs_replace(vitest)`

### Phase B: Job step port alignment

- [ ] **B1** — `JobStepService` is declared as implementing `IJobStepPort`; TypeScript structural assignability passes without method signature mismatches.
  - Evidence: `npm run build` + `src/sidecar/adapters/JobStepService.ts` contains `implements IJobStepPort`

### Phase C: IndexWorkflow happy path

- [ ] **C1** — For one `NoteIndexJob`, fake ports record **`transitionStep` calls** in order: `queued` established → `parsing` → `parsed` → `storing` → `stored` → `summarizing` → `summarized` → `embedding` → `embedded`, then **`queue.ack`** with the item id.
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::C1_happy_path_step_order(vitest)`
- [ ] **C2** — `chunkNote` receives `vaultPath`, `noteTitle`, `markdown`, and `noteId` from the job payload; resulting nodes are passed to `store.upsertNodes`.
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::C2_chunker_inputs(vitest)`
- [ ] **C3** — `SummaryWorkflow` is invoked once during `summarizing` with matching `noteId` / paths (spy on fake or extract shared runner).
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::C3_summary_invoked(vitest)`
- [ ] **C4** — Embedding phase calls `IEmbeddingPort.embed` with batching policy documented in code (batch size ≥ 1); every node that requires a **new** content vector gets `upsertEmbedding` with `EmbedMeta.contentHash === node.contentHash`.
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::C4_embed_meta_matches_node_hash(vitest)`

### Phase D: Idempotent embed skip

- [ ] **D1** — When `getEmbeddingMeta(nodeId,'content')` already matches the node’s `contentHash`, **no** `embed` call includes that node’s text for content vectors (skipped).
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::D1_skip_content_embed(vitest)`

### Phase E: Failure + queue nack

- [ ] **E1** — If `embed` throws, workflow calls `markFailed` with non-empty message and `queue.nack` with reason; **does not** call `ack`.
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::E1_embed_failure_nack(vitest)`

### Phase F: Resume hook

- [ ] **F1** — `resumeInterruptedJobs` (or equivalent) reads `listRecoverableJobs()` and enqueues at least one returned job via `queue.enqueue` when rows are non-terminal.
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::F1_resume_reenqueue(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `src/core/workflows/IndexWorkflow.ts` contains **no** import from `src/sidecar/` paths or `better-sqlite3`.
  - Evidence: `npm run verify:core-imports` or `IndexWorkflow.test.ts::Y1_no_sidecar_imports(vitest)` documenting `rg` invocation
- [ ] **Y2** — **(binding)** `NoteIndexJob` is JSON-serializable (no `undefined`, no functions); document in interface JSDoc; `InProcessQueue<NoteIndexJob>` round-trips through SQLite payload in an integration-style test **or** unit test `JSON.parse(JSON.stringify(job))`.
  - Evidence: `src/core/workflows/IndexWorkflow.test.ts::Y2_payload_json_roundtrip(vitest)`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A unless shared package touched
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Large notes → huge batch embed payloads | Batch by N texts; document N; respect provider limits in PRV-1 adapters. |
| 2 | Tag/xref replace forgets CASCADE edge cases | Run in same transaction as `upsertNodes`; test FK violations. |
| 3 | `listRecoverableJobs` re-enqueues stale paths | WKF-3 tightens with vault hash diff; WKF-2 documents “caller may filter”. |

---

## Implementation Order

1. `IJobStepPort.ts` + `JobStepService implements` (B1).
2. `IDocumentStore` + `SqliteDocumentStore` tag/xref replace (A1).
3. `types.ts` — `NoteIndexJob` (Y2).
4. `IndexWorkflow.ts` + tests — happy path (C\*, D1).
5. Failure + resume (E1, F1).
6. Core import verification (Y1).
7. **Final verify** — `npm run build`, `npm run lint`, full test suite.

---

*Created: 2026-04-05 | Story: WKF-2 | Epic: 4 — Index, summary, and embedding workflows*
