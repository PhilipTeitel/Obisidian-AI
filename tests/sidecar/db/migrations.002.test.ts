import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';
import type { MigrationLogger } from '@src/sidecar/db/migrate.js';
import { runMigrations, runMigration002 } from '@src/sidecar/db/migrate.js';

type SqliteDb = InstanceType<typeof Database>;

function masterNames(db: SqliteDb, type: string): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
    .all(type) as { name: string }[];
  return rows.map((r) => r.name);
}

function migrationsDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src/sidecar/db/migrations',
  );
}

describe('STO-4 migration 002', () => {
  it('A1_fresh_apply', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tables = new Set(masterNames(db, 'table'));
    expect(tables.has('nodes_fts')).toBe(true);
    const indexes = new Set(masterNames(db, 'index'));
    expect(indexes.has('idx_note_meta_note_date')).toBe(true);
    expect(indexes.has('idx_summaries_prompt_version')).toBe(true);
    db.close();
  });

  it('A2_idempotent', () => {
    const db = new Database(':memory:');
    const info = vi.fn();
    const debug = vi.fn();
    const log: MigrationLogger = { info, debug };
    runMigrations(db, log);
    const infoAfterFirst = info.mock.calls.length;
    runMigrations(db, log);
    const rebuildMessages = info.mock.calls.filter((c) =>
      String(c[1]).includes('rebuilding nodes_fts'),
    );
    expect(rebuildMessages.length).toBe(0);
    expect(info.mock.calls.length).toBeGreaterThan(infoAfterFirst);
    db.close();
  });

  it('B1_triggers', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(
      `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
       VALUES ('n1','note1',NULL,'note','[]',0,0,'hello','h1')`,
    ).run();
    const rowid = db.prepare('SELECT rowid FROM nodes WHERE id = ?').get('n1') as { rowid: number };
    let cnt = db.prepare('SELECT COUNT(*) AS c FROM nodes_fts WHERE rowid = ?').get(rowid.rowid) as {
      c: number;
    };
    expect(cnt.c).toBe(1);
    db.prepare(`UPDATE nodes SET content = 'world' WHERE id = 'n1'`).run();
    const doc = db.prepare('SELECT content FROM nodes_fts WHERE rowid = ?').get(rowid.rowid) as {
      content: string;
    };
    expect(doc.content).toBe('world');
    db.prepare('DELETE FROM nodes WHERE id = ?').run('n1');
    cnt = db.prepare('SELECT COUNT(*) AS c FROM nodes_fts WHERE rowid = ?').get(rowid.rowid) as {
      c: number;
    };
    expect(cnt.c).toBe(0);
    db.close();
  });

  it('B2_match_bm25', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const ins = db.prepare(
      `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
       VALUES (?, 'note1', NULL, 'note', '[]', 0, 0, ?, ?)`,
    );
    for (const [id, content, hash] of [
      ['n1', 'Acme Corp meeting notes', 'h1'],
      ['n2', 'acme corp follow-up', 'h2'],
      ['n3', 'unrelated text about gardening', 'h3'],
    ] as const) {
      ins.run(id, content, hash);
    }
    const textRows = db
      .prepare(
        `SELECT n.id FROM nodes_fts
         INNER JOIN nodes n ON n.rowid = nodes_fts.rowid
         WHERE nodes_fts MATCH ?
         ORDER BY bm25(nodes_fts) ASC`,
      )
      .all('acme') as { id: string }[];
    expect(textRows.length).toBe(2);
    expect(textRows.map((r) => r.id).sort()).toEqual(['n1', 'n2'].sort());
    expect(textRows.some((r) => r.id === 'n3')).toBe(false);
    db.close();
  });

  it('D1_columns', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const noteMeta = db.pragma('table_info(note_meta)') as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const nd = noteMeta.find((c) => c.name === 'note_date');
    expect(nd).toBeDefined();
    expect(nd!.type.toUpperCase()).toBe('TEXT');
    expect(nd!.notnull).toBe(0);
    const summaries = db.pragma('table_info(summaries)') as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const pv = summaries.find((c) => c.name === 'prompt_version');
    expect(pv).toBeDefined();
    expect(pv!.type.toUpperCase()).toBe('TEXT');
    expect(pv!.notnull).toBe(1);
    expect(pv!.dflt_value === "'legacy'" || pv!.dflt_value === 'legacy').toBe(true);
    db.close();
  });

  it('D2_backfill', () => {
    const db = new Database(':memory:');
    const sql001 = fs.readFileSync(path.join(migrationsDir(), '001_relational.sql'), 'utf8');
    db.exec(sql001);
    db.pragma('user_version = 1');
    db.prepare(
      `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
       VALUES ('n1','note1',NULL,'note','[]',0,0,'x','h')`,
    ).run();
    db.prepare(`INSERT INTO summaries (node_id, summary, model) VALUES ('n1', 's', 'm')`).run();
    runMigration002(db);
    const row = db.prepare('SELECT prompt_version FROM summaries WHERE node_id = ?').get('n1') as {
      prompt_version: string;
    };
    expect(row.prompt_version).toBe('legacy');
    db.close();
  });

  it('D3_note_date_null', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: 4 });
    const store = new SqliteDocumentStore(db);
    await store.upsertNoteMeta({
      noteId: 'note1',
      vaultPath: 'p.md',
      contentHash: 'h',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    const row = db.prepare('SELECT note_date FROM note_meta WHERE note_id = ?').get('note1') as {
      note_date: string | null;
    };
    expect(row.note_date).toBeNull();
    db.close();
  });

  it('Z5_logs_at_info', () => {
    const db = new Database(':memory:');
    const info = vi.fn();
    const log: MigrationLogger = { info, debug: vi.fn() };
    runMigrations(db, log);
    const msgs = info.mock.calls.map((c) => c[1] as string);
    expect(msgs.some((m) => m.includes('applying migration 002'))).toBe(true);
    expect(msgs.some((m) => m.includes('migration 002 complete'))).toBe(true);
    db.close();
  });
});
