import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { RELATIONAL_USER_VERSION, runRelationalMigrations } from './migrate.js';

type SqliteDb = InstanceType<typeof Database>;

function tableNames(db: SqliteDb): Set<string> {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function indexNames(db: SqliteDb): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe('STO-1 relational migrations', () => {
  it('A1_tables_exist', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    const names = tableNames(db);
    for (const t of [
      'nodes',
      'summaries',
      'tags',
      'cross_refs',
      'note_meta',
      'queue_items',
      'job_steps',
    ]) {
      expect(names.has(t), `missing table ${t}`).toBe(true);
    }
    db.close();
  });

  it('A2_indexes_exist', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    const idx = new Set(indexNames(db));
    for (const name of [
      'idx_nodes_note',
      'idx_nodes_parent',
      'idx_nodes_type',
      'idx_nodes_hash',
      'idx_tags_tag',
      'idx_tags_node',
      'idx_xref_source',
      'idx_xref_target',
      'idx_queue_status',
      'idx_jobs_step',
      'idx_jobs_note',
    ]) {
      expect(idx.has(name), `missing index ${name}`).toBe(true);
    }
    db.close();
  });

  it('A3_check_constraints', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    db.prepare(
      `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
       VALUES ('n1','note1',NULL,'note','[]',0,0,'x','h')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
         VALUES ('n2','note1',NULL,'bad','[]',0,0,'x','h')`,
        )
        .run(),
    ).toThrow();

    db.prepare(
      `INSERT INTO queue_items (id, queue_name, payload, status) VALUES ('q1','q','{}','pending')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO queue_items (id, queue_name, payload, status) VALUES ('q2','q','{}','bad')`,
        )
        .run(),
    ).toThrow();

    db.prepare(
      `INSERT INTO job_steps (job_id, note_path, current_step, content_hash) VALUES ('j1','p.md','queued','h')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO job_steps (job_id, note_path, current_step, content_hash) VALUES ('j2','p.md','bad','h')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('B1_idempotent', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    const before = tableNames(db);
    runRelationalMigrations(db);
    expect(tableNames(db)).toEqual(before);
    db.close();
  });

  it('B2_version_recorded', () => {
    const db = new Database(':memory:');
    runRelationalMigrations(db);
    expect(db.pragma('user_version', { simple: true })).toBe(RELATIONAL_USER_VERSION);
    db.close();
  });

  it('Y2_no_vec_ddl', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
    const sql = fs.readFileSync(path.join(dir, '001_relational.sql'), 'utf8');
    expect(sql.toLowerCase().includes('vec0')).toBe(false);
    expect(sql.toLowerCase().includes('create virtual table')).toBe(false);
  });
});
