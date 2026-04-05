# QUE-1: `InProcessQueue` + `IQueuePort` with crash-safe `queue_items`

**Story**: Implement **`InProcessQueue<T>`** in the sidecar as the [ADR-007](../decisions/ADR-007-queue-abstraction.md) adapter for [IQueuePort](../../src/core/ports/IQueuePort.ts): an **in-memory** dequeue buffer for low latency plus **SQLite persistence** in `queue_items` for crash recovery, with **configurable concurrency** (max parallel workers), and **ack** / **nack** semantics including **retry** and **dead-letter** after `maxRetries` (default **3**, matching [Plugin Settings](../../README.md#plugin-settings)).
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Medium
**Status**: Open

---

## 1. Summary

Domain workflows ([WKF-2](../../README.md#epic-4-index-summary-and-embedding-workflows) later) dequeue work only through **`IQueuePort<T>`**; this story delivers the iteration-2 adapter that satisfies ADR-007’s hybrid design: hot path in memory, durable state in `queue_items`. On process restart, pending/processing items are **reloaded** from SQLite into the in-memory structure so indexing can resume without losing enqueued notes.

**Payload serialization:** Store `payload` as JSON text in `queue_items.payload`; generic `T` must be JSON-serializable for MVP (document constraint). Use a stable `queue_name` string (e.g. `'index-notes'`) to support future multiple queues without schema change.

**Concurrency:** Expose `queueConcurrency` as constructor/config option (default **1**). Workers call `dequeue` up to batch size; only up to `queueConcurrency` items may be `processing` at once — Implementer defines internal worker loop vs external driver; **minimum bar:** even with concurrency 1, persistence + ack/nack must be correct.

**Peek:** `peek()` returns count of items eligible for dequeue (pending, not dead-letter, not completed), matching README / ADR-007.

Depends on **STO-1** (`queue_items` table).

Pointers: [ADR-007](../decisions/ADR-007-queue-abstraction.md); [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) (queue complements `job_steps`; full step integration is QUE-2).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-007-queue-abstraction.md](../decisions/ADR-007-queue-abstraction.md) | Hybrid queue, interface methods, retry/dead-letter behavior. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Adapter runs in sidecar; no queue in plugin. |
| [docs/decisions/ADR-004-per-vault-index-storage.md](../decisions/ADR-004-per-vault-index-storage.md) | Queue rows live in the same per-vault DB as the index. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk
- [ ] **Prerequisite:** [STO-1](STO-1.md) `queue_items` migration available

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Public class **`InProcessQueue<T>`** implements **`IQueuePort<T>`** from core with identical method semantics (async signatures may wrap sync DB — OK).
2. **Y2** — Every successful `enqueue` persists one row per item with `status = 'pending'` and generates a stable string **`id`** (UUID v4 or ULID) returned inside `QueueItem<T>`.
3. **Y3** — `dequeue(batchSize)` returns up to `batchSize` pending items, atomically marking them `processing` in SQLite **and** reflecting that in memory so duplicate dequeue does not occur across restarts.
4. **Y4** — `ack(itemId)` sets `status = 'completed'` and removes or archives the item from the hot dequeue set; `nack(itemId, reason)` increments `retry_count`, sets `error_message`, and either returns item to `pending` (retry) or sets `dead_letter` when `retry_count` exceeds configured `maxRetries`.
5. **Y5** — After simulated restart (new `InProcessQueue` instance, same DB file), items that were `pending` or `processing` reappear as dequeue-eligible **pending** (processing must be reclaimed — ADR-007 crash recovery expectation).
6. **Y6** — `peek()` counts only items that would be eligible for `dequeue` (exclude `completed` and `dead_letter`).

---

## 5. API Endpoints + Schemas

No HTTP routes.

```ts
import type { IQueuePort } from '../../core/ports/IQueuePort.js';

export interface InProcessQueueOptions {
  db: unknown; // better-sqlite3 Database
  queueName: string;
  maxRetries?: number;
  /** Max concurrent processing slots (default 1). */
  queueConcurrency?: number;
}

export class InProcessQueue<T> implements IQueuePort<T> {
  constructor(options: InProcessQueueOptions);
  // implements enqueue, dequeue, ack, nack, peek
}
```

`T` must be JSON-serializable; document if `undefined` in payload is forbidden.

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
| 1 | `src/sidecar/adapters/InProcessQueue.ts` | `IQueuePort` implementation. |
| 2 | `src/sidecar/adapters/InProcessQueue.test.ts` | Persistence, ack/nack, restart simulation, peek. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| — | — | None strictly required beyond STO-1 DB helpers if shared. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IQueuePort.ts` — contract frozen unless ADR-007 changes.
- `src/plugin/**` — no queue persistence.

---

## 8. Acceptance Criteria Checklist

### Phase A: Core semantics

- [ ] **A1** — `enqueue` then `dequeue(10)` returns items with correct typed payload round-trip (e.g. `{ notePath: string, noteId: string }`).
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::A1_enqueue_dequeue_roundtrip(vitest)`

- [ ] **A2** — `ack` removes item from further dequeues; DB row shows `completed`.
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::A2_ack_completes(vitest)`

- [ ] **A3** — `nack` with sub-threshold retries returns item to `pending` and preserves/updates `error_message`.
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::A3_nack_retries(vitest)`

- [ ] **A4** — `nack` beyond `maxRetries` sets `dead_letter`; item never dequeues again.
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::A4_dead_letter(vitest)`

### Phase B: Recovery and visibility

- [ ] **B1** — After items are left `processing`, constructing a **new** `InProcessQueue` against the same DB requeues them as `pending` and they dequeue again.
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::B1_restart_reclaims_processing(vitest)`

- [ ] **B2** — `peek()` matches the number of pending items before dequeue in a multi-item scenario.
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::B2_peek_matches_pending(vitest)`

### Phase C: Concurrency (lightweight)

- [ ] **C1** — With `queueConcurrency` > 1, the adapter does not exceed the configured number of concurrent `processing` slots when driven by parallel dequeue callers **or** documents a single-threaded dequeue driver pattern and enforces slot limit internally — **must** be explicit in implementation + test.
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::C1_concurrency_cap(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `InProcessQueue` lives under `src/sidecar/adapters/` and implements `IQueuePort` imported from `src/core/ports/`.
  - Evidence: `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [ ] **Y2** — **(binding)** Queue persistence uses `queue_items` columns as per README §8 (no ad-hoc extra statuses).
  - Evidence: `src/sidecar/adapters/InProcessQueue.test.ts::Y2_status_values_only_readme(vitest)` (assert CHECK passes / invalid status rejected)

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — All client imports from shared use `@shared/types` alias — N/A; document N/A
- [ ] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | JSON payload evolution | Version field inside payload for future WKF-2 if needed. |
| 2 | `processing` reclaim vs double-execution | Reclaim to `pending` on startup; idempotency still relies on QUE-2/WKF-2 — document at-least-once semantics. |

---

## Implementation Order

1. Implement SQLite statements for insert/update/select with transactions on dequeue.
2. Implement in-memory index (Map/queue) kept in sync with persisted state.
3. Implement startup reload from `queue_items` where `status IN ('pending','processing')`.
4. Add tests A1–A4, B1–B2, C1, Y2.
5. **Final verify** — `npm run build`, `npm test`, `npm run check:boundaries`.

---

*Created: 2026-04-05 | Story: QUE-1 | Epic: 3 — SQLite store, vectors, and indexing persistence*
