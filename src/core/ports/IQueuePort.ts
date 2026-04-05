import type { QueueItem } from '../domain/types.js';

/**
 * Queue port for indexing orchestration (ADR-007, README §18).
 * Adapters may persist to SQLite (`queue_items`) without changing this contract.
 */
export interface IQueuePort<T> {
  enqueue(items: T[]): Promise<void>;
  dequeue(batchSize: number): Promise<QueueItem<T>[]>;
  ack(itemId: string): Promise<void>;
  nack(itemId: string, reason: string): Promise<void>;
  /** Returns the count of pending items (ADR-007 / README: peek queue depth). */
  peek(): Promise<number>;
}
