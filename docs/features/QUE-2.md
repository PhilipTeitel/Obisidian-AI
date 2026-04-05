# QUE-2: `job_steps` integration — idempotent steps, resume, retry cap, progress events

**Story**: Implement a sidecar **job-step service** backed by the `job_steps` table ([README §8](../../README.md#8-sqlite-schema), [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md)) that records per-note **state transitions**, enforces **idempotent** updates, supports **resume** after crash (reload non-terminal jobs), applies a **retry cap** aligned with queue dead-letter policy, and emits **[IProgressPort](../../src/core/ports/IProgressPort.ts)** events using [IndexProgressEvent](../../src/core/domain/types.ts) shapes (including **`runId`** correlation per FND-3 types).
**Epic**: 3 — SQLite store, vectors, and indexing persistence
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story is the **persistence + observability** half of ADR-008: the `IndexWorkflow` (WKF-2) will call this service to move a note through `queued` → … → `embedded` or `failed` / `dead_letter`, while the UI eventually consumes progress via the sidecar transport. Here we implement **durable `job_steps` rows** and **structured `emit` calls** — not the full LLM/embed pipeline.

**Idempotency (ADR-008 §2):** Expose explicit operations such as `ensureJob`, `transitionStep`, `markFailed`, `bumpRetryToQueued` that:

- Refuse illegal backward transitions unless documented (e.g. `failed` → `queued` for retry).
- No-op or short-circuit when the row is already at a **terminal** success state (`embedded`) or **dead_letter** (unless a future “manual retry” API resets — out of scope unless minimal `resetDeadLetter` is needed for tests).

**Progress events:** On every **observable** transition, call `IProgressPort.emit` with:

- `jobId` matching `job_steps.job_id`
- `runId` passed in from caller (WKF-2 will supply the active indexing run)
- `notePath`, `step` (`IndexStep`), `status` (`started` | `completed` | `failed` | `skipped`), optional `detail`

**Correlation:** `job_id` format is product-defined (README suggests `<reindex-run-id>:<note-path>` style); this story **does not** parse it — only stores and echoes.

**Resume:** Provide `listRecoverableJobs(): Promise<JobStep[]>` (or sync) returning rows where `current_step` ∉ { `embedded`, `dead_letter` } for WKF-2 to re-enqueue via `IQueuePort`.

Depends on **STO-1** (`job_steps`). Works alongside **QUE-1** (queue) but must not create circular imports; prefer `JobStepService` taking `Database` + optional `IProgressPort` in constructor.

Pointers: ADR-008; [index/status](../../README.md#sidecar-message-protocol) `jobs: JobStep[]` shape matches [JobStep](../../src/core/domain/types.ts).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                                      | Why it binds this story                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-008-idempotent-indexing-state-machine.md](../decisions/ADR-008-idempotent-indexing-state-machine.md) | State machine, columns, retries, dead-letter, progress emissions.                      |
| [docs/decisions/ADR-007-queue-abstraction.md](../decisions/ADR-007-queue-abstraction.md)                                 | Resume interacts with re-enqueue; retry cap must align with queue `maxRetries` policy. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md)                           | Service runs in sidecar only.                                                          |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk
- [ ] **Prerequisites:** [STO-1](STO-1.md); [QUE-1](QUE-1.md) optional for integration-style tests but unit tests may use DB only

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — All `current_step` values read/written are exactly the lowercase literals in README §8 / `IndexStep` in `types.ts` (no aliases).
2. **Y2** — `transitionStep` updates `updated_at` on every successful write (`datetime('now')` or ISO in UTC consistent with STO-3).
3. **Y3** — On `failed` → retry path, increment `retry_count` when moving back toward `queued` per ADR-008; when `retry_count` exceeds configured max, set `dead_letter` and emit `failed`/`completed` as documented in service JSDoc (align with ADR-008 §5).
4. **Y4** — **Every** persisted step change that represents user-visible progress must emit at least one `IProgressPort.emit` call with coherent `step` + `status` (Implementer lists mapping table in code comment).
5. **Y5** — `IProgressPort` is injected; **no** Obsidian API imports — use a test double capturing events in unit tests.
6. **Y6** — `listRecoverableJobs` (or equivalent) returns rows shaped as `JobStep` domain type (nullable `errorMessage` as `string | null`).

---

## 5. API Endpoints + Schemas

No HTTP routes in this story (SRV-\* will expose `index/status` later). Internal TypeScript API:

```ts
import type { IProgressPort } from '../../core/ports/IProgressPort.js';
import type { IndexProgressStatus, IndexStep, JobStep } from '../../core/domain/types.js';

export interface JobStepServiceOptions {
  db: unknown;
  progress: IProgressPort;
  maxRetries?: number;
}

export class JobStepService {
  constructor(options: JobStepServiceOptions);

  ensureJob(input: { jobId: string; runId: string; notePath: string; contentHash: string }): void;

  transitionStep(input: { jobId: string; runId: string; to: IndexStep; detail?: string }): void;

  markFailed(input: { jobId: string; runId: string; message: string }): void;

  /** Jobs that need re-enqueue after sidecar restart. */
  listRecoverableJobs(): JobStep[];
}
```

Exact method names are Implementer’s choice if the above are mirrored in tests.

---

## 6. Frontend Flow

Not applicable (progress consumer is plugin UI in UI-4 / transport in SRV-5 later).

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                          | Purpose                                                                               |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `src/sidecar/adapters/JobStepService.ts`      | `job_steps` access + progress emit.                                                   |
| 2   | `src/sidecar/adapters/JobStepService.test.ts` | State transitions, idempotency, retry cap, recoverable listing, fake `IProgressPort`. |

### Files to MODIFY

| #   | Path | Change                                                |
| --- | ---- | ----------------------------------------------------- |
| —   | —    | None required in core if types already match ADR-008. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/domain/types.ts` — `IndexStep`, `IndexProgressEvent`, `JobStep` already defined ([FND-3](FND-3.md)); change only if README and ADR-008 change together.

---

## 8. Acceptance Criteria Checklist

### Phase A: Persistence and state machine

- [x] **A1** — `ensureJob` inserts a row with `current_step = 'queued'` (or documented initial) and sets `content_hash`, `note_path`, `job_id`.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::A1_ensure_job(vitest)`

- [x] **A2** — `transitionStep` advances along the ADR-008 ordering (e.g. `queued` → `parsing` → `parsed` → …) and rejects impossible skips unless explicitly allowed with test justification.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::A2_valid_transitions(vitest)`

- [x] **A3** — Idempotent behavior: calling `transitionStep` to the **same** `to` step twice does not corrupt row (second call no-op or safe).
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::A3_idempotent_repeat(vitest)`

### Phase B: Failure, retry, dead-letter

- [x] **B1** — `markFailed` sets `failed` state, stores `error_message`, emits progress with `status: 'failed'`.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::B1_mark_failed(vitest)`

- [x] **B2** — Retry path increments `retry_count` and can return job toward `queued` until cap; beyond cap → `dead_letter` and no further automatic retry.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::B2_retry_and_dead_letter(vitest)`

### Phase C: Resume listing

- [x] **C1** — `listRecoverableJobs` excludes `embedded` and `dead_letter` but includes `failed` and in-progress states per ADR-008 restart narrative.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::C1_recoverable_jobs(vitest)`

### Phase D: Progress emissions

- [x] **D1** — For a linear happy-path transition sequence, the fake `IProgressPort` receives events with correct `jobId`, `runId`, `notePath`, `step`, and `status` values.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::D1_progress_sequence(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** Service module imports `IProgressPort` and domain types from `src/core/` only (ports/domain), not from `src/plugin/`.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` + `scripts/check-source-boundaries.mjs(npm run check:boundaries)`

- [x] **Y2** — **(binding)** SQL uses `job_steps` column names exactly as README §8 (`job_id`, `note_path`, `current_step`, `content_hash`, `retry_count`, `error_message`, `updated_at`).
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::Y2_column_roundtrip(vitest)` (pragma `table_info` or typed read)

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias — N/A; document N/A
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                 | Mitigation                                                                     |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | WKF-2 not yet present — risk of wrong API shape | Keep service methods minimal; add integration test in WKF-2 story later.       |
| 2   | Duplicate progress events                       | Document which transitions emit `started` vs `completed`; tests lock behavior. |

---

## Implementation Order

1. Implement `JobStepService` with typed SQL against `job_steps`.
2. Wire `IProgressPort` emit helper (single internal method).
3. Implement transition validation table (ADR-008 diagram as source).
4. Implement retry/dead-letter counters aligned with [QUE-1](QUE-1.md) `maxRetries` default (3).
5. Tests A1–D1, Y1–Y2, then Z gates.
6. **Final verify** — `npm run build`, `npm test`, boundary scripts.

---

_Created: 2026-04-05 | Story: QUE-2 | Epic: 3 — SQLite store, vectors, and indexing persistence_
