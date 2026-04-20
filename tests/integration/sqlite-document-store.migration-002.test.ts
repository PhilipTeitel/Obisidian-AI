import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import type { MigrationLogger } from '@src/sidecar/db/migrate.js';
import { ensureVectorSchema, runMigrations, runMigration002 } from '@src/sidecar/db/migrate.js';
import { loadSqliteVec } from '@src/sidecar/db/load-sqlite-vec.js';
import { runDocumentStoreContractRoundTrip } from '../contract/document-store.contract.js';

type SqliteDb = InstanceType<typeof Database>;

const TOKENIZER_LITERAL = `tokenize='unicode61 remove_diacritics 1'`;

function migrationsSqlDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/sidecar/db/migrations',
  );
}

function apply001Only(db: SqliteDb): void {
  const sql = fs.readFileSync(path.join(migrationsSqlDir(), '001_relational.sql'), 'utf8');
  db.exec(sql);
  db.pragma('user_version = 1');
}

function sqliteMasterSnapshot(db: SqliteDb): unknown {
  return db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`).all();
}

function openFileDb(filePath: string): SqliteDb {
  const db = new Database(filePath);
  runMigrations(db);
  loadSqliteVec(db);
  ensureVectorSchema(db, { dimension: 4 });
  return db;
}

describe('SqliteDocumentStore migration 002 (binding)', () => {
  it('Y1_idempotent_against_real_sqlite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y1-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      const before = sqliteMasterSnapshot(db);
      runMigrations(db);
      const after = sqliteMasterSnapshot(db);
      expect(after).toEqual(before);
    } finally {
      db.close();
    }
  });

  it('Y2_external_content_and_extensions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y2-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = openFileDb(dbPath);
    try {
      const mods = db.prepare(`SELECT name FROM pragma_module_list WHERE name IN ('fts5','vec0')`).all() as {
        name: string;
      }[];
      const names = new Set(mods.map((m) => m.name));
      expect(names.has('fts5')).toBe(true);
      expect(names.has('vec0')).toBe(true);

      const sqlRow = db
        .prepare(`SELECT sql FROM sqlite_master WHERE name = 'nodes_fts'`)
        .get() as { sql: string };
      expect(sqlRow.sql).toContain("content='nodes'");
      expect(sqlRow.sql).toContain("content_rowid='rowid'");
      expect(sqlRow.sql).toContain(TOKENIZER_LITERAL);

      db.prepare(
        `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
         VALUES ('n1','note1',NULL,'note','[]',0,0,'Acme Corp','h')`,
      ).run();
      const hits = db
        .prepare(`SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH 'acme'`)
        .all() as { rowid: number }[];
      expect(hits.length).toBe(1);
    } finally {
      db.close();
    }
  });

  it('Y4_rebuild_once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y4-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = new Database(dbPath);
    const info = vi.fn();
    const log: MigrationLogger = { info, debug: vi.fn() };
    try {
      apply001Only(db);
      for (let i = 1; i <= 2; i++) {
        db.prepare(
          `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
           VALUES (?,?,NULL,'note','[]',0,0,?,?)`,
        ).run(`n${i}`, 'note1', `c${i}`, `h${i}`);
      }
      runMigration002(db, log);
      const rebuild1 = info.mock.calls.filter((c) => String(c[1]).includes('rebuilding nodes_fts'));
      expect(rebuild1.length).toBe(1);

      info.mockClear();
      runMigration002(db, log);
      const rebuild2 = info.mock.calls.filter((c) => String(c[1]).includes('rebuilding nodes_fts'));
      expect(rebuild2.length).toBe(0);
    } finally {
      db.close();
    }
  });

  it('Y5_note_date_column_and_index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y5-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = openFileDb(dbPath);
    try {
      const cols = db.pragma('table_info(note_meta)') as { name: string }[];
      expect(cols.some((c) => c.name === 'note_date')).toBe(true);
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_note_meta_note_date'")
        .get() as { name: string } | undefined;
      expect(idx?.name).toBe('idx_note_meta_note_date');
    } finally {
      db.close();
    }
  });

  it('Y6_prompt_version_column_and_backfill', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y6-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = new Database(dbPath);
    try {
      apply001Only(db);
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
      const idx = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_summaries_prompt_version'",
        )
        .get() as { name: string } | undefined;
      expect(idx?.name).toBe('idx_summaries_prompt_version');
    } finally {
      db.close();
    }
  });

  it('Y7_additive_no_data_loss', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y7-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = new Database(dbPath);
    try {
      apply001Only(db);
      loadSqliteVec(db);
      ensureVectorSchema(db, { dimension: 4 });
      db.prepare(
        `INSERT INTO nodes (id, note_id, parent_id, type, heading_trail, depth, sibling_order, content, content_hash)
         VALUES ('n1','note1',NULL,'note','[]',0,0,'body','h')`,
      ).run();
      db.prepare(
        `INSERT INTO note_meta (note_id, vault_path, content_hash, indexed_at, node_count)
         VALUES ('note1','p.md','h',datetime('now'),1)`,
      ).run();
      db.prepare(`INSERT INTO summaries (node_id, summary, model) VALUES ('n1','sum','m')`).run();
      const emb = new Float32Array(4);
      emb.fill(0.2);
      db.prepare(`INSERT INTO vec_content (node_id, embedding) VALUES ('n1', ?)`).run(emb);
      db.prepare(
        `INSERT INTO embedding_meta (node_id, vector_type, model, dimension, content_hash)
         VALUES ('n1','content','m',4,'h')`,
      ).run();

      const beforeNodes = db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number };
      runMigration002(db);
      expect(db.prepare('SELECT COUNT(*) AS c FROM nodes').get()).toEqual(beforeNodes);
      const content = db.prepare('SELECT content FROM nodes WHERE id = ?').get('n1') as { content: string };
      expect(content.content).toBe('body');
      const pv = db.prepare('SELECT prompt_version FROM summaries WHERE node_id = ?').get('n1') as {
        prompt_version: string;
      };
      expect(pv.prompt_version).toBe('legacy');
    } finally {
      db.close();
    }
  });

  it('Y8_contract_roundtrip_on_migrated_schema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto4-y8-'));
    const dbPath = path.join(dir, 'vault.db');
    const db = openFileDb(dbPath);
    const store = new SqliteDocumentStore(db);
    try {
      await runDocumentStoreContractRoundTrip(store);
    } finally {
      db.close();
    }
  });
});
