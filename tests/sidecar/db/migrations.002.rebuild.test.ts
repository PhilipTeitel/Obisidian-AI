import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { MigrationLogger } from '@src/sidecar/db/migrate.js';
import { runMigrations } from '@src/sidecar/db/migrate.js';

function migrationsDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src/sidecar/db/migrations',
  );
}

describe('STO-4 migration 002 rebuild path', () => {
  it('C1_rebuild', () => {
    const db = new Database(':memory:');
    const sql001 = fs.readFileSync(path.join(migrationsDir(), '001_relational.sql'), 'utf8');
    db.exec(sql001);
    db.pragma('user_version = 1');
    for (let i = 1; i <= 3; i++) {
      db.prepare(
        `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
         VALUES (?,?,NULL,'note','[]',0,0,?,?)`,
      ).run(`n${i}`, 'note1', `c${i}`, `h${i}`);
    }
    const info = vi.fn();
    const log: MigrationLogger = { info, debug: vi.fn() };
    runMigrations(db, log);
    const ftsRows = db.prepare('SELECT COUNT(*) AS c FROM nodes_fts').get() as { c: number };
    expect(ftsRows.c).toBe(3);
    const rebuildCalls = info.mock.calls.filter((c) => String(c[1]).includes('rebuilding nodes_fts'));
    expect(rebuildCalls.length).toBe(1);
    db.close();
  });

  it('C2_no_rebuild_when_synced', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    for (let i = 1; i <= 2; i++) {
      db.prepare(
        `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
         VALUES (?,?,NULL,'note','[]',0,0,?,?)`,
      ).run(`n${i}`, 'note1', `c${i}`, `h${i}`);
    }
    const before = db.prepare('SELECT COUNT(*) AS c FROM nodes_fts').get() as { c: number };
    expect(before.c).toBe(2);
    const info = vi.fn();
    runMigrations(db, { info, debug: vi.fn() });
    const rebuildCalls = info.mock.calls.filter((c) => String(c[1]).includes('rebuilding nodes_fts'));
    expect(rebuildCalls.length).toBe(0);
    db.close();
  });
});
