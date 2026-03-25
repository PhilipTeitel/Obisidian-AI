#!/usr/bin/env node
/**
 * VEC-0 proof: sqlite-vec vec0 + KNN on a file-backed DB outside any vault.
 *
 * Uses better-sqlite3 + sqlite-vec (Node). Not bundled into the Obsidian main.js bundle.
 *
 * Usage:
 *   npm run spike:vec0
 *   node scripts/vec0-spike.mjs [--out /absolute/path/to/proof.sqlite3]
 *
 * @see docs/decisions/ADR-001-sqlite-vec-stack.md
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
const EMBEDDING_DIM = 1536;

function parseOutFlag() {
  const idx = process.argv.indexOf("--out");
  if (idx === -1 || !process.argv[idx + 1]) {
    return null;
  }
  return process.argv[idx + 1];
}

const customOut = parseOutFlag();
const dbPath =
  customOut ?? join(tmpdir(), "obsidian-ai-vec0-spike", "vec0-proof.sqlite3");

mkdirSync(dirname(dbPath), { recursive: true });

console.log(`VEC-0 spike: opening ${dbPath}`);

const db = new Database(dbPath);

try {
  sqliteVec.load(db);

  const { vec_version: vecVersion } = db.prepare("SELECT vec_version() AS vec_version").get();
  console.log(`sqlite-vec vec_version=${vecVersion}`);

  db.exec(`DROP TABLE IF EXISTS node_embeddings;`);

  db.exec(`
    CREATE VIRTUAL TABLE node_embeddings USING vec0(
      node_id TEXT PRIMARY KEY,
      embedding_type TEXT NOT NULL,
      embedding FLOAT[${EMBEDDING_DIM}]
    );
  `);

  const insert = db.prepare(
    `INSERT INTO node_embeddings (node_id, embedding_type, embedding) VALUES (?, ?, ?)`
  );

  const zeros = new Float32Array(EMBEDDING_DIM);
  const accent = new Float32Array(EMBEDDING_DIM);
  accent[0] = 1;

  insert.run("node-zero", "summary", zeros);
  insert.run("node-accent", "content", accent);

  const query = new Float32Array(EMBEDDING_DIM);
  query[0] = 0.95;

  const knn = db.prepare(`
    SELECT node_id, embedding_type, distance
    FROM node_embeddings
    WHERE embedding MATCH ?
      AND k = 2
    ORDER BY distance
  `);

  const rows = knn.all(query);

  if (rows.length !== 2) {
    throw new Error(`Expected 2 KNN rows, got ${rows.length}`);
  }

  const top = rows[0];
  if (top.node_id !== "node-accent") {
    throw new Error(`Expected closest row node-accent, got ${top.node_id}`);
  }

  console.log("KNN (sqlite-vec MATCH, not JS cosine scan):");
  console.table(rows);
  console.log("VEC-0 spike: OK");
} finally {
  db.close();
}
