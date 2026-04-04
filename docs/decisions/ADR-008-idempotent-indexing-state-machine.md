# ADR-008: Idempotent indexing state machine

## Status

Accepted

## Context

Iteration 1's indexing pipeline ran each note through a monolithic flow: chunk → embed → store. A failure at any point required re-processing the entire note (or the entire vault on crash). With iteration 2 adding LLM summary generation — the most expensive and failure-prone step — the cost of re-processing is unacceptable.

The pipeline now has four distinct phases per note, each with different failure modes and costs:

1. **Parsing** — fast, deterministic, CPU-only
2. **Storing** — fast, local SQLite writes
3. **Summarizing** — slow, LLM API calls, rate-limited, costly
4. **Embedding** — moderate, embedding API calls, rate-limited

A note that completed summarization but failed during embedding should not re-run summarization on retry.

## Decision

### 1. Per-note step tracking via `job_steps` table

Each note's indexing progress is tracked in a `job_steps` SQLite table with the following state machine:

```
[*] → Queued → Parsing → Parsed → Storing → Stored → Summarizing → Summarized → Embedding → Embedded → [*]

Any active state (Parsing, Storing, Summarizing, Embedding) can transition to Failed.
Failed → Queued (retry, up to max retries).
```

The `job_steps` table records:

| Column | Description |
|--------|-------------|
| `job_id` | Unique job identifier (typically `<reindex-run-id>:<note-path>`) |
| `note_path` | Vault-relative path of the note |
| `current_step` | Current state in the state machine |
| `content_hash` | SHA-256 hash of the note's raw content at enqueue time |
| `retry_count` | Number of retries for the current step |
| `error_message` | Last failure reason (null when not in Failed state) |
| `updated_at` | Timestamp of last state transition |

### 2. Idempotency via content hash + step status

Each step checks preconditions before executing:

- **Parsing:** Skip if `content_hash` matches and step >= `Parsed`.
- **Storing:** Skip if nodes for this `content_hash` already exist in the document store.
- **Summarizing:** Skip if summaries exist and are not stale (`generatedAt >= updatedAt` for all nodes).
- **Embedding:** Skip if embeddings exist for the current `content_hash`.

Re-running the pipeline on an already-completed note is a no-op. Re-running after a mid-pipeline failure resumes from the last completed step.

### 3. Crash recovery

On sidecar restart, the `IndexWorkflow` queries `job_steps` for all jobs not in a terminal state (`Embedded` or dead-lettered). These jobs are re-enqueued via `IQueuePort` and resume from their last completed step. No user intervention is required.

### 4. Observable state transitions

Each state transition emits a progress event via `IProgressPort`:

```typescript
interface IndexProgressEvent {
  jobId: string;
  notePath: string;
  step: IndexStep;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  detail?: string;
}
```

The plugin receives these events (via WebSocket or stdio) and renders per-note, per-step progress in the ProgressSlideout UI.

### 5. Dead-letter after max retries

A note that fails the same step more than N times (configurable, default 3) is moved to a dead-letter state. Dead-lettered notes:

- Are excluded from automatic retry on restart.
- Are queryable via `GET /index/status` (or equivalent) for user visibility.
- Can be manually re-enqueued by the user via a "retry failed" command.

### 6. Incremental indexing integration

For incremental indexing (`Index changes`), the workflow:

1. Compares vault file hashes against stored `content_hash` values.
2. Enqueues only notes with changed or new content.
3. For changed notes, marks the job as `Queued` and processes through all steps (parsing may produce a different tree, invalidating downstream summaries/embeddings).
4. For deleted notes, removes all associated data from the document store (no state machine needed — this is a direct cleanup).

## Consequences

- **Positive:** Indexing is restartable without re-doing expensive work; per-note progress is visible to the user; failures are contained to individual notes; retry behavior is predictable and configurable.
- **Negative:** Additional SQLite I/O for step tracking (one write per state transition per note); state machine logic adds complexity to the workflow; content hash computation adds marginal CPU cost per note.
- **Trade-off:** The granularity of steps (4 phases) balances recovery precision against tracking overhead. Finer granularity (e.g., per-node within a note) would add disproportionate tracking cost for marginal recovery benefit.

## Alternatives considered

- **No step tracking (iteration 1 approach):** Re-process entire notes on any failure. Unacceptable with LLM summary costs.
- **Per-node step tracking:** Track each individual node's progress. Too granular — a note with 100 nodes would generate 400 step records. The per-note granularity is sufficient because all steps within a phase for a single note are fast enough to retry atomically.
- **External workflow engine (Temporal, Step Functions):** Over-engineered for a local desktop plugin; adds deployment complexity.
- **Checkpoint files on disk:** Less queryable and harder to correlate with queue state than SQLite rows.

## References

- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §4, §9
- [ADR-007-queue-abstraction.md](./ADR-007-queue-abstraction.md)
- [ADR-006-sidecar-architecture.md](./ADR-006-sidecar-architecture.md)
