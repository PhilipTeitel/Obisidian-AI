import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ensureVectorSchema, getEmbeddingDimension, runRelationalMigrations } from './migrate.js';

describe('STO-2 vector migrations', () => {
  it('A1_vec_tables_roundtrip', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    const dim = 1536;
    ensureVectorSchema(db, { dimension: dim });
    db.prepare(
      `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
       VALUES ('n1','note1',NULL,'note','[]',0,0,'x','h')`,
    ).run();
    const emb = new Float32Array(dim);
    emb.fill(0.1);
    db.prepare('INSERT INTO vec_content (node_id, embedding) VALUES (?, ?)').run('n1', emb);
    const q = new Float32Array(dim);
    q.fill(0.11);
    const row = db
      .prepare(
        'SELECT node_id, distance FROM vec_content WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      )
      .get(q, 1) as {
      node_id: string;
      distance: number;
    };
    expect(row.node_id).toBe('n1');
    expect(Number.isFinite(row.distance)).toBe(true);
    db.close();
  });

  it('A2_embedding_meta_fk', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    ensureVectorSchema(db, { dimension: 4 });
    db.prepare(
      `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
       VALUES ('n1','note1',NULL,'note','[]',0,0,'x','h')`,
    ).run();
    db.prepare(
      `INSERT INTO embedding_meta (node_id, vector_type, model, dimension, content_hash)
       VALUES ('n1','content','m',4,'h')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO embedding_meta (node_id, vector_type, model, dimension, content_hash)
         VALUES ('missing','content','m',4,'h')`,
        )
        .run(),
    ).toThrow();
    db.prepare('DELETE FROM nodes WHERE id = ?').run('n1');
    const cnt = db.prepare('SELECT COUNT(*) as c FROM embedding_meta').get() as { c: number };
    expect(cnt.c).toBe(0);
    db.close();
  });

  it('A3_dimension_parameterized', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    ensureVectorSchema(db, { dimension: 768 });
    expect(getEmbeddingDimension(db)).toBe(768);
    const sql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_content'")
      .get() as { sql: string };
    expect(sql.sql).toContain('768');
    db.close();
  });

  it('B1_dimension_mismatch_fails', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    ensureVectorSchema(db, { dimension: 1536 });
    expect(() => ensureVectorSchema(db, { dimension: 768 })).toThrow(/dimension mismatch/i);
    db.close();
  });

  it('Y2_sidecar_only_load', () => {
    expect(import.meta.url).toContain('sidecar');
  });
});
