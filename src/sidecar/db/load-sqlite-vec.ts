import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

type SqliteDatabase = InstanceType<typeof Database>;

/** Load native sqlite-vec into a better-sqlite3 connection (STO-2, sidecar-only). */
export function loadSqliteVec(db: SqliteDatabase): void {
  sqliteVec.load(db);
}
