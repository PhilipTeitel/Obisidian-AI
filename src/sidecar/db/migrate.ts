import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

type SqliteDatabase = InstanceType<typeof Database>;
import { loadSqliteVec } from './load-sqlite-vec.js';

/**
 * SQL files live in ./migrations next to this module (Vitest / TS source) or next to the built
 * `server.cjs` (esbuild CJS output leaves `import.meta.url` empty, so use `process.argv[1]`).
 */
function migrationsDirectory(): string {
  const metaUrl = import.meta.url;
  if (typeof metaUrl === 'string' && metaUrl.length > 0) {
    return path.join(path.dirname(fileURLToPath(metaUrl)), 'migrations');
  }
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('migrate: cannot resolve migrations directory (no import.meta.url and no argv[1])');
  }
  return path.join(path.dirname(path.resolve(entry)), 'migrations');
}

/** STO-1 baseline: relational tables only. */
export const RELATIONAL_USER_VERSION = 1;

/** STO-2: vec tables + embedding_meta + _schema_meta. */
export const VECTOR_USER_VERSION = 2;

const META_KEY_EMBEDDING_DIMENSION = 'embedding_dimension';

function readMigrationSql(filename: string): string {
  const full = path.join(migrationsDirectory(), filename);
  return fs.readFileSync(full, 'utf8');
}

/**
 * Apply README §8 relational DDL (STO-1). Idempotent via IF NOT EXISTS + user_version.
 */
export function runRelationalMigrations(db: SqliteDatabase): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= RELATIONAL_USER_VERSION) {
    return;
  }
  const sql = readMigrationSql('001_relational.sql');
  db.exec(sql);
  db.pragma(`user_version = ${RELATIONAL_USER_VERSION}`);
}

function ensureSchemaMetaTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getSchemaMeta(db: SqliteDatabase, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM _schema_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setSchemaMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare(
    'INSERT INTO _schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export interface VectorMigrationOptions {
  /** Must match plugin embeddingDimension (default 1536). */
  dimension: number;
}

/**
 * Load sqlite-vec and create vec_content, vec_summary, embedding_meta (STO-2).
 * Call only after runRelationalMigrations.
 */
export function ensureVectorSchema(db: SqliteDatabase, options: VectorMigrationOptions): void {
  const { dimension } = options;
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new Error(`ensureVectorSchema: invalid dimension ${dimension}`);
  }

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < RELATIONAL_USER_VERSION) {
    throw new Error('ensureVectorSchema: run relational migrations first');
  }

  // sqlite-vec registers the vec0 virtual table module per connection, not per database file.
  // Existing vectorized databases still need the extension loaded on every open.
  loadSqliteVec(db);

  if (current >= VECTOR_USER_VERSION) {
    const stored = getSchemaMeta(db, META_KEY_EMBEDDING_DIMENSION);
    if (stored === undefined) {
      throw new Error('ensureVectorSchema: database missing embedding_dimension metadata');
    }
    if (stored !== String(dimension)) {
      throw new Error(
        `ensureVectorSchema: embedding dimension mismatch (db=${stored}, requested=${dimension}); delete the database or reindex with the original dimension.`,
      );
    }
    return;
  }
  ensureSchemaMetaTable(db);

  const d = dimension;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_content USING vec0(
      node_id TEXT PRIMARY KEY,
      embedding FLOAT[${d}]
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summary USING vec0(
      node_id TEXT PRIMARY KEY,
      embedding FLOAT[${d}]
    );
    CREATE TABLE IF NOT EXISTS embedding_meta (
      node_id       TEXT NOT NULL,
      vector_type   TEXT NOT NULL CHECK (vector_type IN ('content','summary')),
      model         TEXT NOT NULL,
      dimension     INTEGER NOT NULL,
      content_hash  TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (node_id, vector_type),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );
  `);

  setSchemaMeta(db, META_KEY_EMBEDDING_DIMENSION, String(dimension));
  db.pragma(`user_version = ${VECTOR_USER_VERSION}`);
}

/** Read persisted embedding dimension after vector migrations (throws if missing). */
export function getEmbeddingDimension(db: SqliteDatabase): number {
  const v = db.pragma('user_version', { simple: true }) as number;
  if (v < VECTOR_USER_VERSION) {
    throw new Error('getEmbeddingDimension: vector schema not applied');
  }
  const raw = getSchemaMeta(db, META_KEY_EMBEDDING_DIMENSION);
  if (raw === undefined) {
    throw new Error('getEmbeddingDimension: _schema_meta missing dimension');
  }
  return Number.parseInt(raw, 10);
}
