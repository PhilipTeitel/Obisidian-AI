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
  }
];
