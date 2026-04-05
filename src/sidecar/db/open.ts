import Database from 'better-sqlite3';
import { ensureVectorSchema, runRelationalMigrations } from './migrate.js';

type SqliteDatabase = InstanceType<typeof Database>;

export interface OpenDatabaseOptions {
  /** When set, applies STO-2 vector schema with this dimension. */
  embeddingDimension?: number;
}

/**
 * Open SQLite at path, apply relational migrations, optionally vector schema.
 */
export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const db = new Database(filePath);
  runRelationalMigrations(db);
  if (options.embeddingDimension !== undefined) {
    ensureVectorSchema(db, { dimension: options.embeddingDimension });
  }
  return db;
}

/**
 * In-memory DB for tests: relational only unless dimension is passed (STO-1 / STO-2 / STO-3).
 */
export function openMigratedMemoryDb(options: OpenDatabaseOptions = {}): SqliteDatabase {
  const db = new Database(':memory:');
  runRelationalMigrations(db);
  if (options.embeddingDimension !== undefined) {
    ensureVectorSchema(db, { dimension: options.embeddingDimension });
  }
  return db;
}
