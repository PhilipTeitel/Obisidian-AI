import { randomUUID } from 'node:crypto';
import type { QueueItem } from '../../core/domain/types.js';
import type { IQueuePort } from '../../core/ports/IQueuePort.js';
import Database from 'better-sqlite3';

type SqliteDatabase = InstanceType<typeof Database>;

export interface InProcessQueueOptions {
  db: SqliteDatabase;
  queueName: string;
  maxRetries?: number;
  /** Max concurrent `processing` rows for this queue (default 1). */
  queueConcurrency?: number;
}

/**
 * ADR-007: durable `queue_items` for crash recovery.
 * `dequeue` is serialized internally so concurrent callers still respect `queueConcurrency`
 * against SQLite `processing` counts (QUE-1 C1).
 */
export class InProcessQueue<T> implements IQueuePort<T> {
  private readonly db: SqliteDatabase;
  private readonly queueName: string;
  private readonly maxRetries: number;
  private readonly queueConcurrency: number;
  /** Serializes dequeues so `queueConcurrency` is evaluated atomically vs SQLite. */
  private deferChain: Promise<unknown> = Promise.resolve();

  constructor(options: InProcessQueueOptions) {
    this.db = options.db;
    this.queueName = options.queueName;
    this.maxRetries = options.maxRetries ?? 3;
    this.queueConcurrency = options.queueConcurrency ?? 1;
    this.reclaimProcessing();
  }

  /** ADR-007: processing items become pending again after restart. */
  private reclaimProcessing(): void {
    this.db
      .prepare(
        `UPDATE queue_items
         SET status = 'pending', updated_at = datetime('now')
         WHERE queue_name = ? AND status = 'processing'`,
      )
      .run(this.queueName);
  }

  countProcessing(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM queue_items
         WHERE queue_name = ? AND status = 'processing'`,
      )
      .get(this.queueName) as { c: number };
    return row.c;
  }

  async enqueue(items: T[]): Promise<void> {
    const ins = this.db.prepare(
      `INSERT INTO queue_items (id, queue_name, payload, status, retry_count, enqueued_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, datetime('now'), datetime('now'))`,
    );
    const txn = this.db.transaction(() => {
      for (const payload of items) {
        ins.run(randomUUID(), this.queueName, JSON.stringify(payload));
      }
    });
    txn();
  }

  private dequeueSync(batchSize: number): QueueItem<T>[] {
    const slots = this.queueConcurrency - this.countProcessing();
    if (slots <= 0) return [];
    const limit = Math.min(batchSize, slots);
    const idRows = this.db.transaction(() => {
      const ids = this.db
        .prepare(
          `SELECT id FROM queue_items
           WHERE queue_name = ? AND status = 'pending'
           ORDER BY enqueued_at ASC
           LIMIT ?`,
        )
        .all(this.queueName, limit) as { id: string }[];
      if (ids.length === 0) return [] as { id: string }[];
      const placeholders = ids.map(() => '?').join(',');
      this.db
        .prepare(
          `UPDATE queue_items
           SET status = 'processing', updated_at = datetime('now')
           WHERE id IN (${placeholders})`,
        )
        .run(...ids.map((r) => r.id));
      return ids;
    })() as { id: string }[];
    if (idRows.length === 0) return [];
    const out: QueueItem<T>[] = [];
    const sel = this.db.prepare('SELECT id, payload FROM queue_items WHERE id = ?');
    for (const { id } of idRows) {
      const row = sel.get(id) as { id: string; payload: string };
      out.push({ id: row.id, payload: JSON.parse(row.payload) as T });
    }
    return out;
  }

  async dequeue(batchSize: number): Promise<QueueItem<T>[]> {
    const p = this.deferChain.then(() => this.dequeueSync(batchSize));
    this.deferChain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  async ack(itemId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE queue_items
         SET status = 'completed', updated_at = datetime('now')
         WHERE id = ? AND queue_name = ?`,
      )
      .run(itemId, this.queueName);
  }

  async nack(itemId: string, reason: string): Promise<void> {
    const row = this.db
      .prepare('SELECT retry_count FROM queue_items WHERE id = ? AND queue_name = ?')
      .get(itemId, this.queueName) as { retry_count: number } | undefined;
    if (!row) return;
    const nextRetry = row.retry_count + 1;
    if (nextRetry > this.maxRetries) {
      this.db
        .prepare(
          `UPDATE queue_items
           SET status = 'dead_letter',
               retry_count = ?,
               error_message = ?,
               updated_at = datetime('now')
           WHERE id = ? AND queue_name = ?`,
        )
        .run(nextRetry, reason, itemId, this.queueName);
    } else {
      this.db
        .prepare(
          `UPDATE queue_items
           SET status = 'pending',
               retry_count = ?,
               error_message = ?,
               updated_at = datetime('now')
           WHERE id = ? AND queue_name = ?`,
        )
        .run(nextRetry, reason, itemId, this.queueName);
    }
  }

  async peek(): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM queue_items
         WHERE queue_name = ? AND status = 'pending'`,
      )
      .get(this.queueName) as { c: number };
    return row.c;
  }
}
