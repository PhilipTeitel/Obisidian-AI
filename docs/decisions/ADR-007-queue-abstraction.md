# ADR-007: Queue abstraction for indexing orchestration

## Status

Accepted

## Context

Iteration 1's `IndexingService` was a monolithic orchestrator that drove chunking, embedding, and storage in a single imperative flow. This created several problems:

- No crash recovery: a failure mid-batch required restarting from scratch.
- No concurrency control: rate-limited provider APIs were hammered without backpressure.
- No observability into per-note progress: the UI could only show coarse phase-level feedback.
- Tight coupling between orchestration logic and execution order made the pipeline hard to test and impossible to distribute.

Iteration 2 adds LLM summary generation as a new indexing phase, increasing pipeline complexity and the cost of failures.

## Decision

### 1. `IQueuePort<T>` interface

All indexing work items flow through a queue port:

```typescript
interface IQueuePort<T> {
  enqueue(items: T[]): Promise<void>;
  dequeue(batchSize: number): Promise<QueueItem<T>[]>;
  ack(itemId: string): Promise<void>;
  nack(itemId: string, reason: string): Promise<void>;
  peek(): Promise<number>;
}
```

The domain workflows (`IndexWorkflow`) interact only with this interface. Whether items come from an in-memory array, a SQLite table, or RabbitMQ is transparent to the domain.

### 2. Iteration 2 adapter: `InProcessQueue`

The `InProcessQueue` adapter provides:

- An in-memory array as the primary data structure for low-latency dequeue.
- **SQLite-backed persistence** for crash recovery: enqueued items and their status are written to a `queue_items` table. On restart, incomplete items are reloaded from SQLite.
- **Configurable concurrency** (default: 1 for summarize/embed steps to respect provider rate limits).
- **Dead-letter tracking** after N retries (configurable, default 3). Items that exceed the retry limit are moved to a dead-letter state and excluded from future dequeue calls. Dead-letter items are queryable for debugging.
- **Batch dequeue** with configurable batch size for throughput tuning.

### 3. Future adapters (not in iteration 2)

The interface supports future implementations:

- `RabbitMQAdapter` — for distributed processing across multiple workers.
- `SQSAdapter` — for cloud-native deployments.

These are out of scope for iteration 2 but the interface is designed to accommodate them without domain logic changes.

### 4. Queue items are typed per workflow

Each workflow defines its own queue item type (e.g., `NoteJobItem` for indexing). The queue is generic over the item type, enforcing type safety at the boundary.

## Consequences

- **Positive:** Crash recovery without full restart; per-note progress visibility; concurrency control respects provider rate limits; testable in isolation with in-memory queues; future-proof for distributed processing.
- **Negative:** Additional complexity over a simple loop; SQLite persistence adds I/O overhead per enqueue/ack (mitigated by batching); in-process queue does not provide true message broker guarantees (at-least-once delivery is best-effort within a single process).
- **Constraint:** The in-process queue is single-process only. True multi-worker distribution requires a future adapter.

## Alternatives considered

- **Simple for-loop with try/catch:** Iteration 1 approach — no crash recovery, no concurrency control, no per-note observability.
- **Full message broker (RabbitMQ/Redis Streams) in iteration 2:** Over-engineered for a local desktop plugin; adds deployment complexity and a new runtime dependency.
- **SQLite-only queue (no in-memory layer):** Higher latency per dequeue; the hybrid approach keeps hot-path fast while persisting for recovery.

## References

- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §4, §9
- [ADR-008-idempotent-indexing-state-machine.md](./ADR-008-idempotent-indexing-state-machine.md)
- [ADR-006-sidecar-architecture.md](./ADR-006-sidecar-architecture.md)
