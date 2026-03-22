import type { VectorStoreMigration } from "../types";

export const VECTOR_STORE_MIGRATIONS: VectorStoreMigration[] = [
  {
    id: "001_initial_chunk_embeddings",
    description: "Create base chunk embedding tables and sqlite-vec virtual index.",
    statements: [
      "CREATE TABLE IF NOT EXISTS chunk_embeddings (chunk_id TEXT PRIMARY KEY, note_path TEXT NOT NULL, note_title TEXT NOT NULL, heading TEXT, snippet TEXT NOT NULL, tags_json TEXT NOT NULL, dimensions INTEGER NOT NULL, embedding_json TEXT NOT NULL, updated_at INTEGER NOT NULL);",
      "CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_note_path ON chunk_embeddings(note_path);",
      "CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_updated_at ON chunk_embeddings(updated_at);",
      "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embedding_vec_index USING vec0(chunk_id TEXT PRIMARY KEY, embedding FLOAT[1536]);"
    ]
  },
  {
    id: "002_similarity_query_indexes",
    description: "Add indexes supporting nearest-neighbor query filters and metadata reads.",
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_note_path_chunk_id ON chunk_embeddings(note_path, chunk_id);",
      "CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_note_title ON chunk_embeddings(note_title);"
    ]
  },
  {
    id: "003_hierarchical_model",
    description:
      "Create hierarchical node tables (nodes, node_children, node_summaries, node_embeddings, node_tags, node_cross_refs, metadata) and drop legacy flat chunk tables. Full reindex required after migration.",
    statements: [
      // -- Hierarchical tables --
      "CREATE TABLE IF NOT EXISTS nodes (node_id TEXT PRIMARY KEY, parent_id TEXT, note_path TEXT NOT NULL, note_title TEXT NOT NULL, heading_trail TEXT NOT NULL, depth INTEGER NOT NULL, node_type TEXT NOT NULL, content TEXT NOT NULL, sequence_index INTEGER NOT NULL DEFAULT 0, content_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (parent_id) REFERENCES nodes(node_id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS node_children (parent_id TEXT NOT NULL, child_id TEXT NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY (parent_id, child_id), FOREIGN KEY (parent_id) REFERENCES nodes(node_id) ON DELETE CASCADE, FOREIGN KEY (child_id) REFERENCES nodes(node_id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS node_summaries (node_id TEXT PRIMARY KEY, summary TEXT NOT NULL, model_used TEXT NOT NULL, prompt_version TEXT NOT NULL, generated_at INTEGER NOT NULL, FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE);",
      "CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings USING vec0(node_id TEXT PRIMARY KEY, embedding_type TEXT NOT NULL, embedding FLOAT[1536]);",
      "CREATE TABLE IF NOT EXISTS node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (node_id, tag), FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS node_cross_refs (source_node_id TEXT NOT NULL, target_path TEXT NOT NULL, target_display TEXT, FOREIGN KEY (source_node_id) REFERENCES nodes(node_id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);",

      // -- Indexes for hierarchical tables --
      "CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);",
      "CREATE INDEX IF NOT EXISTS idx_nodes_note_path ON nodes(note_path);",
      "CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);",
      "CREATE INDEX IF NOT EXISTS idx_nodes_content_hash ON nodes(content_hash);",
      "CREATE INDEX IF NOT EXISTS idx_node_children_parent ON node_children(parent_id, sort_order);",
      "CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);",
      "CREATE INDEX IF NOT EXISTS idx_node_tags_node ON node_tags(node_id);",
      "CREATE INDEX IF NOT EXISTS idx_node_cross_refs_source ON node_cross_refs(source_node_id);",
      "CREATE INDEX IF NOT EXISTS idx_node_cross_refs_target ON node_cross_refs(target_path);",
      "CREATE INDEX IF NOT EXISTS idx_node_summaries_generated ON node_summaries(generated_at);",

      // -- Drop legacy flat chunk tables and indexes --
      "DROP INDEX IF EXISTS idx_chunk_embeddings_note_path;",
      "DROP INDEX IF EXISTS idx_chunk_embeddings_updated_at;",
      "DROP INDEX IF EXISTS idx_chunk_embeddings_note_path_chunk_id;",
      "DROP INDEX IF EXISTS idx_chunk_embeddings_note_title;",
      "DROP TABLE IF EXISTS chunk_embedding_vec_index;",
      "DROP TABLE IF EXISTS chunk_embeddings;"
    ]
  }
];
