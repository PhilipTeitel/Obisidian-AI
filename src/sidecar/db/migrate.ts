import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

type SqliteDatabase = InstanceType<typeof Database>;
import { loadSqliteVec } from './load-sqlite-vec.js';

/** Optional logger for migration 002 (STO-4); matches pino-style (object, message). */
export type MigrationLogger = {
  info(meta: Record<string, unknown>, msg: string): void;
  debug(meta: Record<string, unknown>, msg: string): void;
};

const noopMigrationLogger: MigrationLogger = {
  info(): void {},
  debug(): void {},
};

function resolveMigrationLogger(log?: MigrationLogger): MigrationLogger {
  return log ?? noopMigrationLogger;
}

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
    throw new Error(
      'migrate: cannot resolve migrations directory (no import.meta.url and no argv[1])',
    );
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

function tableColumnNames(db: SqliteDatabase, table: string): Set<string> {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * STO-4: FTS5 (`nodes_fts`), `note_meta.note_date`, `summaries.prompt_version`.
 * Steps 1–3 run in a transaction; FTS5 `rebuild` runs outside (SQLite forbids it in a transaction).
 */
export function runMigration002(db: SqliteDatabase, log?: MigrationLogger): void {
  const logger = resolveMigrationLogger(log);
  logger.info({ step: 'sto4_migration_002_start' }, 'STO-4: applying migration 002 (FTS5, note_date, prompt_version)');

  const txn = db.transaction(() => {
    const noteMetaCols = tableColumnNames(db, 'note_meta');
    if (!noteMetaCols.has('note_date')) {
      db.exec('ALTER TABLE note_meta ADD COLUMN note_date TEXT');
      logger.debug({ column: 'note_meta.note_date' }, 'STO-4: added note_meta.note_date');
    } else {
      logger.debug({ column: 'note_meta.note_date' }, 'STO-4: note_meta.note_date already present');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_note_meta_note_date ON note_meta(note_date)');

    const summaryCols = tableColumnNames(db, 'summaries');
    if (!summaryCols.has('prompt_version')) {
      db.exec(`ALTER TABLE summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'legacy'`);
      logger.debug({ column: 'summaries.prompt_version' }, 'STO-4: added summaries.prompt_version');
    } else {
      logger.debug({ column: 'summaries.prompt_version' }, 'STO-4: summaries.prompt_version already present');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_summaries_prompt_version ON summaries(prompt_version)');

    db.exec(readMigrationSql('002_fts.sql'));
  });
  txn();

  // FTS5 external-content rebuild cannot run inside the transaction above (SQLite limitation).
  // For content='nodes', COUNT(*) on the nodes_fts shadow can mirror node rows before the
  // full-text index is populated; nodes_fts_docsize stays empty until rebuild/triggers index content.
  const docsizeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes_fts_docsize').get() as {
    c: number;
  };
  const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number };
  if (docsizeCount.c === 0 && nodeCount.c > 0) {
    logger.info(
      { step: 'nodes_fts_rebuild', nodeCount: nodeCount.c },
      'STO-4: rebuilding nodes_fts (index empty, nodes non-empty)',
    );
    db.exec(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`);
  }

  logger.info({ step: 'sto4_migration_002_complete' }, 'STO-4: migration 002 complete');
}

/**
 * Apply STO-1 relational DDL then STO-4 migration 002. Idempotent.
 * Alias for acceptance criteria that name `runMigrations`.
 */
export function runMigrations(db: SqliteDatabase, log?: MigrationLogger): void {
  runRelationalMigrations(db, log);
}

/**
 * Apply README §8 relational DDL (STO-1), then STO-4 additive migration 002.
 * Idempotent via user_version for 001 and guards + IF NOT EXISTS for 002.
 */
export function runRelationalMigrations(db: SqliteDatabase, log?: MigrationLogger): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < RELATIONAL_USER_VERSION) {
    const sql = readMigrationSql('001_relational.sql');
    db.exec(sql);
    db.pragma(`user_version = ${RELATIONAL_USER_VERSION}`);
  }
  runMigration002(db, log);
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
