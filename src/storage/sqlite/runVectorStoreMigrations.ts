import { createRuntimeLogger } from "../../logging/runtimeLogger";
import type { VectorStoreMigration } from "../../types";
import { VECTOR_STORE_MIGRATIONS } from "../vectorStoreSchema";

const logger = createRuntimeLogger("runVectorStoreMigrations");

/**
 * Single row in `metadata`: JSON array of applied migration IDs in application order
 * (e.g. `["001_initial_chunk_embeddings","002_similarity_query_indexes","003_hierarchical_model"]`).
 * The `metadata` table is created by this runner before any migration runs so 001/002 can be tracked
 * even though migration 003 also issues `CREATE TABLE IF NOT EXISTS metadata`.
 */
export const VECTOR_STORE_MIGRATION_METADATA_KEY = "applied_vector_store_migrations";

const BOOTSTRAP_METADATA_DDL =
  "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);";

const SQL_SNIPPET_MAX_LEN = 200;

export const truncateMigrationSql = (sql: string, maxLen = SQL_SNIPPET_MAX_LEN): string => {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen)}…`;
};

/**
 * sqlite3.oo1.DB-compatible surface used by the migration runner (exec, selectValue, transaction).
 */
export interface VectorStoreMigrationDb {
  exec: (sql: string | { sql: string; bind?: unknown }) => void;
  selectValue: (sql: string, bind?: unknown, asType?: unknown) => unknown;
  transaction: <T>(callback: (db: VectorStoreMigrationDb) => T) => T;
}

const parseAppliedMigrationIds = (raw: unknown): string[] => {
  if (raw === null || raw === undefined) {
    return [];
  }
  if (typeof raw !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

export const getAppliedMigrationIds = (db: VectorStoreMigrationDb): string[] => {
  const raw = db.selectValue(
    "SELECT value FROM metadata WHERE key = ?",
    VECTOR_STORE_MIGRATION_METADATA_KEY
  );
  return parseAppliedMigrationIds(raw);
};

export const recordMigrationApplied = (
  db: VectorStoreMigrationDb,
  orderedAppliedIds: readonly string[]
): void => {
  const payload = JSON.stringify([...orderedAppliedIds]);
  db.exec({
    sql: "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
    bind: [VECTOR_STORE_MIGRATION_METADATA_KEY, payload]
  });
};

const validateAppliedPrefix = (
  applied: readonly string[],
  expectedOrderedIds: readonly string[]
): void => {
  if (applied.length > expectedOrderedIds.length) {
    throw new Error(
      `metadata.${VECTOR_STORE_MIGRATION_METADATA_KEY} has unexpected length (${applied.length}).`
    );
  }
  for (let i = 0; i < applied.length; i += 1) {
    if (applied[i] !== expectedOrderedIds[i]) {
      throw new Error(
        `metadata.${VECTOR_STORE_MIGRATION_METADATA_KEY} is out of sync at index ${i}: expected "${expectedOrderedIds[i]}", found "${applied[i]}".`
      );
    }
  }
};

/**
 * Runs pending migrations from `migrations` in order. Defaults to {@link VECTOR_STORE_MIGRATIONS}.
 * Each migration runs in a single SQLite transaction; on failure the transaction is rolled back and
 * the migration is not recorded.
 */
export const runVectorStoreMigrations = async (
  db: VectorStoreMigrationDb,
  migrations: VectorStoreMigration[] = VECTOR_STORE_MIGRATIONS
): Promise<void> => {
  db.exec(BOOTSTRAP_METADATA_DDL);

  const expectedIds = migrations.map((m) => m.id);
  let applied = getAppliedMigrationIds(db);
  validateAppliedPrefix(applied, expectedIds);

  const appliedSet = new Set(applied);

  for (const migration of migrations) {
    if (appliedSet.has(migration.id)) {
      continue;
    }

    logger.info({
      event: "storage.sqlite.migration.started",
      message: "Applying vector store migration.",
      context: { migrationId: migration.id }
    });

    try {
      db.transaction((tx) => {
        for (let statementIndex = 0; statementIndex < migration.statements.length; statementIndex += 1) {
          const sql = migration.statements[statementIndex];
          try {
            tx.exec(sql);
          } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.log({
              level: "error",
              event: "storage.sqlite.migration.statement_failed",
              message: err.message,
              context: {
                migrationId: migration.id,
                statementIndex,
                sql: truncateMigrationSql(sql)
              }
            });
            throw err;
          }
        }

        const nextApplied = [...applied, migration.id];
        recordMigrationApplied(tx, nextApplied);
        applied = nextApplied;
      });

      appliedSet.add(migration.id);

      logger.info({
        event: "storage.sqlite.migration.completed",
        message: "Vector store migration applied.",
        context: { migrationId: migration.id }
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.log({
        level: "error",
        event: "storage.sqlite.migration.failed",
        message: err.message,
        context: { migrationId: migration.id }
      });
      throw err;
    }
  }
};
