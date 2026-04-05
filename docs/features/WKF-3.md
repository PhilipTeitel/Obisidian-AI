# WKF-3: Incremental indexing — changed-note detection, reuse, deleted-note cleanup

**Story**: Implement **incremental indexing orchestration** that compares **vault file hashes** to **`note_meta`**, builds **`IndexIncrementalRequest`**-shaped work (files to upsert + `deletedPaths`), **enqueues** only changed/new notes via **`IQueuePort<NoteIndexJob>`**, and performs **direct cleanup** for deleted paths ([ADR-008 §6](../decisions/ADR-008-idempotent-indexing-state-machine.md)) without running the full per-note state machine — while reusing **WKF-1 / WKF-2 skip logic** for unchanged content inside changed files.
**Epic**: 4 — Index, summary, and embedding workflows
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Full vault reindex is expensive; iteration 2 targets **“Index changes”** ([REQUIREMENTS §3](../requirements/REQUIREMENTS.md)) by only enqueueing notes whose **content hash** differs from `note_meta.contentHash` or that have **no** meta row yet. **Deleted** notes must remove index data immediately: **`IDocumentStore.deleteNote`**, remove **`job_steps`** rows for that vault path (Implementer: `note_path` column matches `vaultPath` / path string used as `noteId`), and clear **queue** rows whose JSON payload references that path — **minimum:** delete store + job_steps; queue cleanup documented if deferred (prefer full cleanup in this story to avoid zombie jobs).

This story **does not** implement Obsidian file watching (PLG-6 / commands in UI-5 trigger the incremental runner). It **does** define the **pure/pluggable function(s)** the sidecar or plugin will call once file lists + hashes are known.

**Relationship to WKF-2:** Reuses `IndexWorkflow.processOneJob` for **mutated** notes. For **unchanged** notes, **no enqueue**.

**Relationship to WKF-1:** Unchanged subtrees inside a changed file still benefit from **summary/embed skips** already implemented in WKF-1 and embedding phase of WKF-2.

**Inputs (explicit):**

- `currentFiles: { path: string; content: string; hash: string }[]` — scoped to configured include/exclude folders (caller responsibility per README settings).
- `store: IDocumentStore` for `getNoteMeta` / deletes.
- `queue: IQueuePort<NoteIndexJob>` for new/changed only.
- `runId: string` for correlation.
- Optional: `jobSteps: IJobStepPort` to delete rows by `note_path` for deleted notes.

**Output:** `{ enqueued: number; deleted: number; skipped: number }` (Implementer may extend).

Pointers: [IndexIncrementalRequest](../../src/core/domain/types.ts); README [§19](../../README.md#19-idempotent-indexing-state-machine) incremental bullet.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) | §6 incremental rules; deleted-note direct cleanup. |
| [ADR-007](../decisions/ADR-007-queue-abstraction.md) | Only changed items enqueued; queue remains source of durable work. |
| [ADR-004](../decisions/ADR-004-per-vault-index-storage.md) | `note_meta` is per-vault DB; no cross-vault deletes. |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Vault bytes are supplied by caller; core function stays testable. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — **Hash comparison** uses the same **SHA-256 of raw file bytes** (UTF-8 string as read from vault) as `job_steps.content_hash` / `note_meta.content_hash` / `IndexFilePayload.hash` conventions in [README API Contract](../../README.md#api-contract) — document hex encoding (lowercase) consistent with chunker `contentHash` on `DocumentNode`.
2. **Y2** — **Deleted paths:** call `IDocumentStore.deleteNote(noteId)` where `noteId` is the **same string key** used in `note_meta.note_id` and `NoteIndexJob.noteId` (MVP: vault-relative path).
3. **Y3** — **No state machine** for deletes: **do not** `ensureJob` / `transitionStep` for pure deletion cleanup.
4. **Y4** — **`job_steps`** rows whose `note_path` matches a deleted vault path must be removed (SQL `DELETE`) so `listRecoverableJobs` never resurrects deleted notes — implement via **`IJobStepPort` extension** or small **`IJobCleanupPort`** if `deleteByNotePath` is not on QUE-2’s surface (Implementer adds **one** narrow port or extends `IJobStepPort` with `deleteJobForPath(notePath: string): void`).
5. **Y5** — Incremental planner lives in **`src/core/`** without Obsidian imports.

---

## 5. API Endpoints + Schemas

No HTTP routes.

Extend **`IJobStepPort`** (from [WKF-2](WKF-2.md)) **or** add `IIndexingCleanupPort`:

```ts
/** Remove durable job row when note is deleted from vault (ADR-008 §6). */
export interface IJobStepPort {
  // ... existing from WKF-2 ...
  deleteJobForNotePath(notePath: string): void;
}
```

Add **incremental planner** module:

```ts
export interface IncrementalIndexInput {
  runId: string;
  files: IndexFilePayload[]; // path, content, hash
  deletedPaths: string[];
  noteTitlesByPath: Record<string, string>; // or parallel array — Implementer picks
}

export interface IncrementalIndexDeps {
  store: IDocumentStore;
  queue: IQueuePort<NoteIndexJob>;
  jobSteps: IJobStepPort;
}

export async function planAndApplyIncrementalIndex(
  deps: IncrementalIndexDeps,
  input: IncrementalIndexInput,
): Promise<{ enqueued: number; deleted: number; skipped: number }>;
```

`NoteIndexJob` payloads for enqueued items must include **fresh** `markdown`, `contentHash`, `vaultPath`, `noteTitle`, `noteId`.

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
| 1 | `src/core/workflows/IncrementalIndexPlanner.ts` | Diff vs `note_meta`, enqueue, delete orchestration. |
| 2 | `src/core/workflows/IncrementalIndexPlanner.test.ts` | Unit tests with in-memory fakes. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/ports/IJobStepPort.ts` | Add `deleteJobForNotePath` (or separate port file if WKF-2 not merged yet — coordinate with WKF-2 implementer). |
| 2 | `src/sidecar/adapters/JobStepService.ts` | Implement `deleteJobForNotePath` with `DELETE FROM job_steps WHERE note_path = ?`. |
| 3 | `src/sidecar/adapters/JobStepService.test.ts` | Assert delete removes row. |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/domain/chunker.ts` — hashing rules already centralized; planner imports types only.
- `InProcessQueue.ts` — optional: if zombie queue rows for deleted paths must be purged, add **optional** `purgePayloadContainingPath` in a follow-up; **prefer** documenting queue purge in this story’s risks if technically heavy.

---

## 8. Acceptance Criteria Checklist

### Phase A: Diff logic

- [x] **A1** — Given `files` where hash equals `getNoteMeta(noteId)?.contentHash`, the planner **does not** call `enqueue`.
  - Evidence: `src/core/workflows/IncrementalIndexPlanner.test.ts::A1_skip_unchanged(vitest)`
- [x] **A2** — Given a file with **new** hash vs meta, planner enqueues **exactly one** `NoteIndexJob` with `contentHash` matching the file’s hash.
  - Evidence: `src/core/workflows/IncrementalIndexPlanner.test.ts::A2_enqueue_changed(vitest)`
- [x] **A3** — Given a path in `files` with **no** `note_meta` row, planner enqueues (treat as new).
  - Evidence: `src/core/workflows/IncrementalIndexPlanner.test.ts::A3_enqueue_new_note(vitest)`

### Phase B: Deletes

- [x] **B1** — For each `deletedPaths` entry, planner calls `store.deleteNote(noteId)` with `noteId === path`.
  - Evidence: `src/core/workflows/IncrementalIndexPlanner.test.ts::B1_delete_note_store(vitest)`
- [x] **B2** — Same delete batch calls `jobSteps.deleteJobForNotePath(path)` so `job_steps` has no row with that `note_path`.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::B2_delete_job_by_path(vitest)`

### Phase C: Integration-shaped DB test (optional but recommended)

- [x] **C1** — With real `better-sqlite3` temp DB (migrations applied), insert `note_meta` + `job_steps`, run `planAndApplyIncrementalIndex` with `deletedPaths`, assert both tables no longer reference the note.
  - Evidence: `src/sidecar/adapters/JobStepService.test.ts::C1_incremental_delete_integration(vitest)` **or** new `IncrementalIndexPlanner.integration.test.ts`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `IncrementalIndexPlanner.ts` has no `obsidian` / `better-sqlite3` imports.
  - Evidence: `IncrementalIndexPlanner.test.ts::Y1_core_only(vitest)` + `rg` assertion documented

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A unless shared package touched
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Queue still holds pending job for deleted path | Add `InProcessQueue` purge by path **or** document that dequeue + nack cleans up; prefer purge helper in sidecar if user deletes many notes. |
| 2 | `noteId` vs `vaultPath` mismatch | Standardize on path string in planner JSDoc and WKF-2 payloads. |
| 3 | Renamed files look like delete + add | MVP treats as two operations; future story may add rename detection. |

---

## Implementation Order

1. Extend `IJobStepPort` + `JobStepService` + tests for `deleteJobForNotePath` (B2).
2. Implement `IncrementalIndexPlanner.ts` (A\*, B1).
3. Unit tests for diff + delete (A\*, B1).
4. Optional integration test (C1).
5. **Final verify** — `npm run build`, `npm run lint`, tests.

---

*Created: 2026-04-05 | Story: WKF-3 | Epic: 4 — Index, summary, and embedding workflows*
