import { describe, expect, it } from "vitest";
import type { VectorStoreMigration } from "../../types";
import { VECTOR_STORE_MIGRATIONS } from "../../storage/vectorStoreSchema";
import {
  getAppliedMigrationIds,
  recordMigrationApplied,
  runVectorStoreMigrations,
  truncateMigrationSql,
  VECTOR_STORE_MIGRATION_METADATA_KEY,
  type VectorStoreMigrationDb
} from "../../storage/sqlite/runVectorStoreMigrations";

describe("runVectorStoreMigrations", () => {
  describe("truncateMigrationSql (B2)", () => {
    it("truncates long SQL for logs", () => {
      const long = "a".repeat(250);
      expect(truncateMigrationSql(long, 200).length).toBeLessThanOrEqual(201);
      expect(truncateMigrationSql(long, 200).endsWith("…")).toBe(true);
    });
  });

  const createMockDb = (): {
    db: VectorStoreMigrationDb;
    getMetadataJson: () => string | null;
    getTransactionCallCount: () => number;
  } => {
    let metadataJson: string | null = null;
    let snapshot: string | null = null;
    let transactionCallCount = 0;

    const execImpl = (input: string | { sql: string; bind?: unknown }): void => {
      if (typeof input === "object" && input.bind !== undefined) {
        const bind = input.bind as [string, string];
        if (bind[0] === VECTOR_STORE_MIGRATION_METADATA_KEY) {
          metadataJson = bind[1];
        }
        return;
      }
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("__FAIL__")) {
        throw new Error("simulated statement failure");
      }
    };

    const db: VectorStoreMigrationDb = {
      exec: (input) => {
        execImpl(input);
      },
      selectValue: (sql, bind) => {
        if (typeof bind !== "string" || !sql.includes("metadata")) {
          return undefined;
        }
        if (bind !== VECTOR_STORE_MIGRATION_METADATA_KEY) {
          return undefined;
        }
        return metadataJson;
      },
      transaction: <T>(callback: (inner: VectorStoreMigrationDb) => T): T => {
        transactionCallCount += 1;
        snapshot = metadataJson;
        try {
          return callback(db);
        } catch (error) {
          metadataJson = snapshot;
          throw error;
        }
      }
    };

    return {
      db,
      getMetadataJson: () => metadataJson,
      getTransactionCallCount: () => transactionCallCount
    };
  };

  it("C1 — runner defaults to VECTOR_STORE_MIGRATIONS from vectorStoreSchema", async () => {
    const { db, getMetadataJson } = createMockDb();
    await runVectorStoreMigrations(db);
    const applied = getAppliedMigrationIds(db);
    expect(applied).toEqual(VECTOR_STORE_MIGRATIONS.map((m) => m.id));
    expect(JSON.parse(getMetadataJson()!)).toEqual(applied);
  });

  it("A2 — second run skips applied migrations (idempotent)", async () => {
    const { db, getTransactionCallCount } = createMockDb();
    await runVectorStoreMigrations(db);
    expect(getTransactionCallCount()).toBe(VECTOR_STORE_MIGRATIONS.length);
    await runVectorStoreMigrations(db);
    expect(getTransactionCallCount()).toBe(VECTOR_STORE_MIGRATIONS.length);
    await runVectorStoreMigrations(db);
    expect(getAppliedMigrationIds(db)).toEqual(VECTOR_STORE_MIGRATIONS.map((m) => m.id));
  });

  it("A3 — metadata lists all migration ids in order after success", async () => {
    const { db, getMetadataJson } = createMockDb();
    await runVectorStoreMigrations(db);
    const fromRow = JSON.parse(getMetadataJson()!);
    expect(fromRow).toEqual(["001_initial_chunk_embeddings", "002_similarity_query_indexes", "003_hierarchical_model"]);
  });

  it("B1 — failure rolls back migration batch (metadata unchanged)", async () => {
    const failing: VectorStoreMigration[] = [
      {
        id: "001_ok",
        description: "",
        statements: ["SELECT 1", "__FAIL__"]
      }
    ];
    const { db, getMetadataJson } = createMockDb();
    await expect(runVectorStoreMigrations(db, failing)).rejects.toThrow("simulated statement failure");
    expect(getMetadataJson()).toBeNull();
  });

  it("rejects metadata that is not a prefix of the expected migration order", async () => {
    const { db } = createMockDb();
    recordMigrationApplied(db, ["002_similarity_query_indexes"]);
    await expect(runVectorStoreMigrations(db)).rejects.toThrow(/out of sync at index 0/);
  });

  /**
   * A1 with real sqlite-vec WASM: the bundled `sqlite-vec-wasm-demo` build is web/Electron-only
   * (“not compiled for this environment” under Node). Confirm in Obsidian after VEC-4 persistence:
   * open vault, trigger vector DB open, inspect exported DB or logs for `nodes` and metadata row
   * `applied_vector_store_migrations`.
   */
  it.skip("A1 — fresh DB applies 001→003 on real WASM (manual / Electron)", async () => {
    expect.fail("Run manually in Obsidian; see test comment above.");
  });
});
