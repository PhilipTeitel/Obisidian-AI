import { describe, expect, it } from "vitest";
import { VECTOR_STORE_MIGRATIONS } from "../../storage/vectorStoreSchema";

const getMigration003 = () => {
  const migration = VECTOR_STORE_MIGRATIONS[2];
  if (!migration || migration.id !== "003_hierarchical_model") {
    throw new Error("Migration 003_hierarchical_model not found at index 2");
  }
  return migration;
};

const allStatements = () => getMigration003().statements;

const findStatement = (fragment: string): string | undefined =>
  allStatements().find((s) => s.includes(fragment));

describe("STOR-1: Hierarchical SQLite schema migration", () => {
  describe("Phase A: Migration Structure", () => {
    it("A1 — migration 003_hierarchical_model exists at index 2", () => {
      expect(VECTOR_STORE_MIGRATIONS).toHaveLength(3);
      const migration = VECTOR_STORE_MIGRATIONS[2];
      expect(migration.id).toBe("003_hierarchical_model");
      expect(migration.description).toBeTruthy();
      expect(migration.statements.length).toBeGreaterThan(0);
    });

    it("A2 — all statements are non-empty strings ending with semicolons and contain no placeholders", () => {
      for (const statement of allStatements()) {
        expect(typeof statement).toBe("string");
        expect(statement.length).toBeGreaterThan(0);
        expect(statement.trimEnd().endsWith(";")).toBe(true);
        expect(statement).not.toContain("{dimensions}");
        expect(statement).not.toContain("{");
        expect(statement).not.toContain("}");
      }
    });
  });

  describe("Phase B: Hierarchical Table Creation", () => {
    it("B1 — nodes table is created with all required columns", () => {
      const stmt = findStatement("CREATE TABLE IF NOT EXISTS nodes");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("node_id TEXT PRIMARY KEY");
      expect(stmt).toContain("parent_id TEXT");
      expect(stmt).toContain("note_path TEXT NOT NULL");
      expect(stmt).toContain("note_title TEXT NOT NULL");
      expect(stmt).toContain("heading_trail TEXT NOT NULL");
      expect(stmt).toContain("depth INTEGER NOT NULL");
      expect(stmt).toContain("node_type TEXT NOT NULL");
      expect(stmt).toContain("content TEXT NOT NULL");
      expect(stmt).toContain("sequence_index INTEGER NOT NULL DEFAULT 0");
      expect(stmt).toContain("content_hash TEXT NOT NULL");
      expect(stmt).toContain("updated_at INTEGER NOT NULL");
      expect(stmt).toContain("FOREIGN KEY (parent_id) REFERENCES nodes(node_id) ON DELETE CASCADE");
    });

    it("B2 — node_children table is created with composite primary key", () => {
      const stmt = findStatement("CREATE TABLE IF NOT EXISTS node_children");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("parent_id TEXT NOT NULL");
      expect(stmt).toContain("child_id TEXT NOT NULL");
      expect(stmt).toContain("sort_order INTEGER NOT NULL");
      expect(stmt).toContain("PRIMARY KEY (parent_id, child_id)");
      expect(stmt).toContain("FOREIGN KEY (parent_id) REFERENCES nodes(node_id) ON DELETE CASCADE");
      expect(stmt).toContain("FOREIGN KEY (child_id) REFERENCES nodes(node_id) ON DELETE CASCADE");
    });

    it("B3 — node_summaries table is created with provenance columns", () => {
      const stmt = findStatement("CREATE TABLE IF NOT EXISTS node_summaries");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("node_id TEXT PRIMARY KEY");
      expect(stmt).toContain("summary TEXT NOT NULL");
      expect(stmt).toContain("model_used TEXT NOT NULL");
      expect(stmt).toContain("prompt_version TEXT NOT NULL");
      expect(stmt).toContain("generated_at INTEGER NOT NULL");
      expect(stmt).toContain("FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE");
    });

    it("B4 — node_embeddings virtual table is created via sqlite-vec", () => {
      const stmt = findStatement("CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("USING vec0");
      expect(stmt).toContain("node_id TEXT PRIMARY KEY");
      expect(stmt).toContain("embedding_type TEXT NOT NULL");
      expect(stmt).toContain("embedding FLOAT[1536]");
    });

    it("B5 — node_tags table is created with composite primary key", () => {
      const stmt = findStatement("CREATE TABLE IF NOT EXISTS node_tags");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("node_id TEXT NOT NULL");
      expect(stmt).toContain("tag TEXT NOT NULL");
      expect(stmt).toContain("PRIMARY KEY (node_id, tag)");
      expect(stmt).toContain("FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE");
    });

    it("B6 — node_cross_refs table is created", () => {
      const stmt = findStatement("CREATE TABLE IF NOT EXISTS node_cross_refs");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("source_node_id TEXT NOT NULL");
      expect(stmt).toContain("target_path TEXT NOT NULL");
      expect(stmt).toContain("target_display TEXT");
      expect(stmt).toContain("FOREIGN KEY (source_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE");
    });

    it("B7 — metadata table is created", () => {
      const stmt = findStatement("CREATE TABLE IF NOT EXISTS metadata");
      expect(stmt).toBeDefined();
      expect(stmt).toContain("key TEXT PRIMARY KEY");
      expect(stmt).toContain("value TEXT");
    });
  });

  describe("Phase C: Index Creation", () => {
    it("C1 — all required indexes are created", () => {
      const expectedIndexes = [
        "idx_nodes_parent_id",
        "idx_nodes_note_path",
        "idx_nodes_node_type",
        "idx_nodes_content_hash",
        "idx_node_children_parent",
        "idx_node_tags_tag",
        "idx_node_tags_node",
        "idx_node_cross_refs_source",
        "idx_node_cross_refs_target",
        "idx_node_summaries_generated"
      ];

      for (const indexName of expectedIndexes) {
        const stmt = findStatement(indexName);
        expect(stmt, `Expected index ${indexName} to be created`).toBeDefined();
        expect(stmt).toContain("CREATE INDEX IF NOT EXISTS");
      }
    });
  });

  describe("Phase D: Old Table Cleanup", () => {
    it("D1 — old chunk_embeddings table is dropped", () => {
      const stmt = findStatement("DROP TABLE IF EXISTS chunk_embeddings");
      expect(stmt).toBeDefined();
    });

    it("D2 — old chunk_embedding_vec_index virtual table is dropped", () => {
      const stmt = findStatement("DROP TABLE IF EXISTS chunk_embedding_vec_index");
      expect(stmt).toBeDefined();
    });

    it("D3 — old indexes from migrations 001 and 002 are dropped", () => {
      const expectedDrops = [
        "idx_chunk_embeddings_note_path;",
        "idx_chunk_embeddings_updated_at",
        "idx_chunk_embeddings_note_path_chunk_id",
        "idx_chunk_embeddings_note_title"
      ];

      for (const indexFragment of expectedDrops) {
        const stmt = allStatements().find(
          (s) => s.includes("DROP INDEX") && s.includes(indexFragment)
        );
        expect(stmt, `Expected DROP INDEX for ${indexFragment}`).toBeDefined();
      }
    });
  });

  describe("Phase E: Backward Compatibility", () => {
    it("E1 — existing migrations 001 and 002 are unchanged", () => {
      expect(VECTOR_STORE_MIGRATIONS[0].id).toBe("001_initial_chunk_embeddings");
      expect(VECTOR_STORE_MIGRATIONS[0].statements).toHaveLength(4);

      expect(VECTOR_STORE_MIGRATIONS[1].id).toBe("002_similarity_query_indexes");
      expect(VECTOR_STORE_MIGRATIONS[1].statements).toHaveLength(2);
    });

    it("E2 — schema version reflects all three migrations", () => {
      expect(VECTOR_STORE_MIGRATIONS).toHaveLength(3);
      const allIds = VECTOR_STORE_MIGRATIONS.map((m) => m.id);
      expect(allIds).toEqual([
        "001_initial_chunk_embeddings",
        "002_similarity_query_indexes",
        "003_hierarchical_model"
      ]);
    });
  });
});
