import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runRelationalMigrations } from '@src/sidecar/db/migrate.js';
import { InProcessQueue } from '@src/sidecar/adapters/InProcessQueue.js';

type Payload = { notePath: string; noteId: string };
type SqliteDb = InstanceType<typeof Database>;

function freshDb(): SqliteDb {
  const db = new Database(':memory:');
  runRelationalMigrations(db);
  return db;
}

describe('InProcessQueue', () => {
  it('A1_enqueue_dequeue_roundtrip', async () => {
    const db = freshDb();
    const q = new InProcessQueue<Payload>({ db, queueName: 'index-notes' });
    await q.enqueue([{ notePath: 'a.md', noteId: '1' }]);
    const items = await q.dequeue(10);
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ notePath: 'a.md', noteId: '1' });
    db.close();
  });

  it('A2_ack_completes', async () => {
    const db = freshDb();
    const q = new InProcessQueue<Payload>({ db, queueName: 'q' });
    await q.enqueue([{ notePath: 'x', noteId: 'y' }]);
    const [item] = await q.dequeue(1);
    await q.ack(item.id);
    const again = await q.dequeue(5);
    expect(again).toHaveLength(0);
    const row = db.prepare('SELECT status FROM queue_items WHERE id = ?').get(item.id) as {
      status: string;
    };
    expect(row.status).toBe('completed');
    db.close();
  });

  it('A3_nack_retries', async () => {
    const db = freshDb();
    const q = new InProcessQueue<Payload>({ db, queueName: 'q', maxRetries: 3 });
    await q.enqueue([{ notePath: 'x', noteId: 'y' }]);
    const [item] = await q.dequeue(1);
    await q.nack(item.id, 'e1');
    const row = db
      .prepare('SELECT status, retry_count, error_message FROM queue_items WHERE id = ?')
      .get(item.id) as { status: string; retry_count: number; error_message: string };
    expect(row.status).toBe('pending');
    expect(row.retry_count).toBe(1);
    expect(row.error_message).toBe('e1');
    db.close();
  });

  it('A4_dead_letter', async () => {
    const db = freshDb();
    const q = new InProcessQueue<Payload>({ db, queueName: 'q', maxRetries: 2 });
    await q.enqueue([{ notePath: 'x', noteId: 'y' }]);
    const [item] = await q.dequeue(1);
    await q.nack(item.id, 'a');
    await q.dequeue(1);
    await q.nack(item.id, 'b');
    await q.dequeue(1);
    await q.nack(item.id, 'c');
    const row = db
      .prepare('SELECT status, retry_count FROM queue_items WHERE id = ?')
      .get(item.id) as { status: string; retry_count: number };
    expect(row.status).toBe('dead_letter');
    expect(row.retry_count).toBe(3);
    const more = await q.dequeue(5);
    expect(more).toHaveLength(0);
    db.close();
  });

  it('B1_restart_reclaims_processing', async () => {
    const db = freshDb();
    let q = new InProcessQueue<Payload>({ db, queueName: 'q' });
    await q.enqueue([{ notePath: 'p', noteId: 'i' }]);
    const [item] = await q.dequeue(1);
    expect(item.payload.notePath).toBe('p');
    q = new InProcessQueue<Payload>({ db, queueName: 'q' });
    const again = await q.dequeue(1);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(item.id);
    db.close();
  });

  it('B2_peek_matches_pending', async () => {
    const db = freshDb();
    const q = new InProcessQueue<Payload>({ db, queueName: 'q' });
    await q.enqueue([
      { notePath: 'a', noteId: '1' },
      { notePath: 'b', noteId: '2' },
    ]);
    expect(await q.peek()).toBe(2);
    await q.dequeue(1);
    expect(await q.peek()).toBe(1);
    db.close();
  });

  it('C1_concurrency_cap', async () => {
    const db = freshDb();
    const q = new InProcessQueue<Payload>({
      db,
      queueName: 'q',
      queueConcurrency: 2,
    });
    await q.enqueue([
      { notePath: 'a', noteId: '1' },
      { notePath: 'b', noteId: '2' },
      { notePath: 'c', noteId: '3' },
    ]);
    const first = await q.dequeue(10);
    expect(first).toHaveLength(2);
    const second = await q.dequeue(10);
    expect(second).toHaveLength(0);
    await q.ack(first[0].id);
    const third = await q.dequeue(10);
    expect(third).toHaveLength(1);
    db.close();
  });

  it('Y2_status_values_only_readme', () => {
    const db = freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO queue_items (id, queue_name, payload, status) VALUES ('x','q','{}','bad')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
