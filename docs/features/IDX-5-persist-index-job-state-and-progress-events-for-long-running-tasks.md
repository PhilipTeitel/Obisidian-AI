# IDX-5: Persist index job state and progress events for long-running tasks

**Story**: Persist indexing job lifecycle state and emit structured progress updates so long-running reindex/incremental runs are observable, resumable, and protected against duplicate concurrent execution.
**Epic**: Epic 2 — Indexing and Metadata Pipeline
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story formalizes indexing as a tracked job lifecycle rather than a single terminal snapshot. `IndexingService` should emit progress transitions during crawl/chunk/embed/finalize stages, persist terminal state, and expose enough state to recover gracefully after interruptions.

IDX-5 builds directly on IDX-3/IDX-4 by adding durable operational visibility. Without persisted job state, users cannot understand where long indexing runs failed, and the runtime cannot reliably prevent duplicate jobs or recover an interrupted run.

The key constraint is deterministic, low-overhead state management: progress updates must be frequent enough to power UI feedback but structured and bounded so they do not create noisy writes or unstable tests.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin and does not use `shared/types.ts`; IDX-5 type additions should be defined in `src/types.ts`.

The following NEW or CHANGED interfaces should be introduced:

```ts
export type IndexingStage = "queued" | "crawl" | "chunk" | "embed" | "finalize";

export interface IndexingRunOptions {
  onProgress?: (snapshot: JobSnapshot) => void;
}

export interface PersistedIndexJobState {
  activeJob: JobSnapshot | null;
  lastCompletedJob: JobSnapshot | null;
  history: JobSnapshot[]; // bounded history, newest first
}

export interface IndexingServiceContract extends RuntimeServiceLifecycle {
  reindexVault(options?: IndexingRunOptions): Promise<JobSnapshot>;
  indexChanges(options?: IndexingRunOptions): Promise<JobSnapshot>;
  getActiveJob(): JobSnapshot | null;
}
```

If the contract surface is expanded, all runtime callers/tests must be updated in the same change.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Obsidian command callback (main.ts)
└── runIndexCommand(..., runCommand)
    └── IndexingService.reindexVault({ onProgress }) / indexChanges({ onProgress })
        ├── emit JobSnapshot(stage=crawl/chunk/embed/...)
        ├── persist active/terminal state via IndexJobStateStore
        ├── enforce single active indexing job
        └── return terminal JobSnapshot
            └── ProgressSlideout.setStatus(snapshot) on each progress update
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `IndexingService.reindexVault` | `(options?: IndexingRunOptions) => Promise<JobSnapshot>` | Active job guard + lifecycle transitions | Emits progress snapshots and persists state |
| `IndexingService.indexChanges` | `(options?: IndexingRunOptions) => Promise<JobSnapshot>` | Same as above | Shares lifecycle mechanics with incremental flow |
| `IndexJobStateStore` | `load()/save()` | Persistent state | Stores active job, last completed job, bounded history |
| `ProgressSlideout.setStatus` | `(snapshot: JobSnapshot) => void` | UI only | Receives intermediate + terminal snapshots, not only final result |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Slideout updates stage-specific progress labels/details as job advances |
| Error   | Failed snapshot is persisted and rendered with normalized error detail |
| Empty   | No-change incremental runs still emit a short stage sequence ending in succeeded terminal snapshot |
| Success | Terminal `succeeded` snapshot is persisted as `lastCompletedJob` and shown in slideout |

Frontend work is limited to consuming richer snapshot updates through existing command/slideout surfaces.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/indexing/IndexJobStateStore.ts` | Persist active/last/history job snapshots for indexing workflows |
| 2 | `src/__tests__/unit/indexJobStateStore.test.ts` | Verify persistence, bounded history behavior, and fallback handling |
| 3 | `src/__tests__/integration/indexing.progress-flow.test.ts` | Integration tests for on-progress callback flow and duplicate-job prevention |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add `IndexingRunOptions`, expanded `IndexingServiceContract`, and persisted job state types |
| 2 | `src/services/IndexingService.ts` | Emit stage progress snapshots, persist lifecycle state, and enforce single active indexing job |
| 3 | `src/bootstrap/bootstrapRuntimeServices.ts` | Inject job-state store dependency into indexing service |
| 4 | `src/main.ts` | Pass progress callback into indexing commands so `ProgressSlideout` updates during execution |
| 5 | `src/ui/ProgressSlideout.ts` | Ensure stage/detail updates render cleanly for intermediate running snapshots |
| 6 | `src/__tests__/unit/services.runtime.test.ts` | Update indexing service call signatures and add active-job assertions |
| 7 | `src/__tests__/integration/plugin.runtime.test.ts` | Validate command behavior with progressive updates and terminal state |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — parsing logic is orthogonal to job-state persistence
- `src/utils/vaultCrawler.ts` — vault traversal logic remains unchanged
- `src/services/SearchService.ts` — search path does not participate in indexing job persistence

---

## 5. Acceptance Criteria Checklist

### Phase A: Persisted Job Lifecycle State

- [x] **A1** — Active indexing job state is persisted at start and cleared at terminal state
  - Starting `reindexVault`/`indexChanges` writes `activeJob` with `status: "running"`.
  - On terminal success/failure/cancelled, `activeJob` is cleared and terminal snapshot is persisted.

- [x] **A2** — Last completed indexing job is retained with bounded history
  - Terminal snapshot is written to `lastCompletedJob`.
  - History retention is bounded (for example most recent 20 entries) to avoid unbounded plugin data growth.

- [x] **A3** — Persisted state read failures degrade safely
  - Malformed/missing persisted state falls back to empty defaults.
  - Indexing commands continue execution with warning-level logs instead of hard failure where possible.

### Phase B: Progress Event Emission

- [x] **B1** — Indexing emits stage-level progress snapshots throughout the run
  - At minimum: `crawl`, `chunk`, `embed`, `finalize`, and terminal snapshot.
  - Snapshot labels/details are deterministic and suitable for UI rendering.

- [x] **B2** — Command path consumes real-time progress updates
  - `main.ts` passes an `onProgress` callback that updates `ProgressSlideout` for intermediate states.
  - Slideout reflects running state during execution, not only terminal completion.

- [x] **B3** — Duplicate concurrent indexing jobs are blocked
  - If an indexing job is already active, new index command invocation is rejected with a clear error/notice.
  - Guard behavior is covered by tests for both reindex and index-changes entry points.

### Phase C: Verification Coverage

- [x] **C1** — Job-state store tests validate persistence and bounded history semantics
  - Unit tests cover initial empty state, active->terminal transitions, and history cap behavior.
  - Tests verify fallback for malformed persisted payload.

- [x] **C2** — Integration tests validate progress callback sequence
  - Tests assert expected stage order for representative reindex/incremental runs.
  - Tests assert terminal snapshot persistence and UI state updates.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Frequent progress writes may create unnecessary persistence churn | Persist key lifecycle transitions and throttle high-frequency updates where needed |
| 2 | Expanding service contract can ripple through tests/runtime wiring | Update all call sites atomically and maintain compile-safe typing |
| 3 | Duplicate-job guard could block legitimate retries after crashes | Couple guard with IDX-6 recovery logic to reconcile stale active-job states |

---

## Implementation Order

1. `src/types.ts` — add indexing progress/state contracts and expanded indexing service method signatures (covers A1, A2, B1).
2. `src/services/indexing/IndexJobStateStore.ts` — implement persisted active/last/history state with bounded retention (covers A1, A2, A3, C1).
3. `src/services/IndexingService.ts` — emit stage progress snapshots, persist lifecycle updates, and enforce single active indexing job (covers B1, B3, A1, A2).
4. `src/bootstrap/bootstrapRuntimeServices.ts` — wire job-state store dependency into indexing service construction (covers A3).
5. `src/main.ts` and `src/ui/ProgressSlideout.ts` — pass/consume `onProgress` snapshots during command execution (covers B2).
6. `src/__tests__/unit/indexJobStateStore.test.ts`, `src/__tests__/unit/services.runtime.test.ts`, `src/__tests__/integration/indexing.progress-flow.test.ts`, and `src/__tests__/integration/plugin.runtime.test.ts` — validate persistence, callback sequencing, and duplicate-job guards (covers C1, C2, B3).
7. **Verify** — run `npm run test` and `npm run lint` to confirm lifecycle behavior and typing (covers Z2, Z3).
8. **Final verify** — run `npm run build`, execute long-running indexing manually, and confirm stage updates are visible end-to-end (covers Z1, Z4).

---

*Created: 2026-02-23 | Story: IDX-5 | Epic: Epic 2 — Indexing and Metadata Pipeline*
