import type {
  DocumentNode,
  EmbedMeta,
  NodeFilter,
  NoteMeta,
  ParsedCrossRef,
  ParsedTag,
  StoredSummary,
  VectorMatch,
  VectorType,
} from '../../core/domain/types.js';
import type { IDocumentStore } from '../../core/ports/IDocumentStore.js';
import Database from 'better-sqlite3';
import { getEmbeddingDimension } from '../db/migrate.js';

type SqliteDatabase = InstanceType<typeof Database>;

function rowToDocumentNode(row: Record<string, unknown>): DocumentNode {
  const trailRaw = row.heading_trail as string | null;
  let headingTrail: string[] = [];
  if (trailRaw) {
    try {
      headingTrail = JSON.parse(trailRaw) as string[];
    } catch {
      headingTrail = [];
    }
  }
  return {
    id: row.id as string,
    noteId: row.note_id as string,
    parentId: (row.parent_id as string | null) ?? null,
    type: row.type as DocumentNode['type'],
    headingTrail,
    depth: row.depth as number,
    siblingOrder: row.sibling_order as number,
    content: row.content as string,
    contentHash: row.content_hash as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * SQLite + sqlite-vec implementation of {@link IDocumentStore} (STO-3).
 * Expects relational + vector migrations applied; ANN uses sqlite-vec L2 `distance`.
 */
export class SqliteDocumentStore implements IDocumentStore {
  private readonly dimension: number;

  constructor(private readonly db: SqliteDatabase) {
    this.dimension = getEmbeddingDimension(db);
  }

  private assertVectorLength(v: Float32Array, label: string): void {
    if (v.length !== this.dimension) {
      throw new Error(`${label}: expected length ${this.dimension}, got ${v.length}`);
    }
  }

  async upsertNodes(nodes: DocumentNode[]): Promise<void> {
    if (nodes.length === 0) return;
    const noteIds = [...new Set(nodes.map((n) => n.noteId))];
    const txn = this.db.transaction(() => {
      for (const nid of noteIds) {
        this.db.prepare('DELETE FROM nodes WHERE note_id = ?').run(nid);
      }
      const ins = this.db.prepare(`
        INSERT INTO nodes (
          id, note_id, parent_id, type, heading_trail, depth, sibling_order,
          content, content_hash, created_at, updated_at
        ) VALUES (
          @id, @note_id, @parent_id, @type, @heading_trail, @depth, @sibling_order,
          @content, @content_hash, @created_at, @updated_at
        )
      `);
      for (const n of nodes) {
        ins.run({
          id: n.id,
          note_id: n.noteId,
          parent_id: n.parentId,
          type: n.type,
          heading_trail: JSON.stringify(n.headingTrail),
          depth: n.depth,
          sibling_order: n.siblingOrder,
          content: n.content,
          content_hash: n.contentHash,
          created_at: n.createdAt,
          updated_at: n.updatedAt,
        });
      }
    });
    txn();
  }

  async replaceNoteTags(noteId: string, tags: ParsedTag[]): Promise<void> {
    const txn = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM tags WHERE node_id IN (SELECT id FROM nodes WHERE note_id = ?)`)
        .run(noteId);
      const ins = this.db.prepare(
        `INSERT INTO tags (node_id, tag, source) VALUES (?, ?, ?)`,
      );
      for (const t of tags) {
        ins.run(t.nodeId, t.tag, t.source);
      }
    });
    txn();
  }

  async replaceNoteCrossRefs(noteId: string, refs: ParsedCrossRef[]): Promise<void> {
    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM cross_refs WHERE source_node_id IN (SELECT id FROM nodes WHERE note_id = ?)`,
        )
        .run(noteId);
      const ins = this.db.prepare(
        `INSERT INTO cross_refs (source_node_id, target_path, link_text) VALUES (?, ?, ?)`,
      );
      for (const r of refs) {
        ins.run(r.sourceNodeId, r.targetPath, r.linkText);
      }
    });
    txn();
  }

  async getNodesByNote(noteId: string): Promise<DocumentNode[]> {
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE note_id = ? ORDER BY depth ASC, sibling_order ASC`)
      .all(noteId) as Record<string, unknown>[];
    return rows.map(rowToDocumentNode);
  }

  async deleteNote(noteId: string): Promise<void> {
    this.db.prepare('DELETE FROM note_meta WHERE note_id = ?').run(noteId);
    this.db.prepare('DELETE FROM nodes WHERE note_id = ?').run(noteId);
  }

  async upsertSummary(nodeId: string, summary: string, model: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO summaries (node_id, summary, model, generated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(node_id) DO UPDATE SET
           summary = excluded.summary,
           model = excluded.model,
           generated_at = datetime('now')`,
      )
      .run(nodeId, summary, model);
  }

  async getSummary(nodeId: string): Promise<StoredSummary | null> {
    const row = this.db
      .prepare('SELECT summary, generated_at, model FROM summaries WHERE node_id = ?')
      .get(nodeId) as
      | { summary: string; generated_at: string; model: string | null }
      | undefined;
    if (!row) return null;
    return {
      summary: row.summary,
      generatedAt: row.generated_at,
      model: row.model ?? null,
    };
  }

  async getEmbeddingMeta(nodeId: string, vectorType: VectorType): Promise<EmbedMeta | null> {
    const row = this.db
      .prepare(
        'SELECT model, dimension, content_hash FROM embedding_meta WHERE node_id = ? AND vector_type = ?',
      )
      .get(nodeId, vectorType) as
      | { model: string; dimension: number; content_hash: string }
      | undefined;
    if (!row) return null;
    return {
      model: row.model,
      dimension: row.dimension,
      contentHash: row.content_hash,
    };
  }

  async upsertEmbedding(
    nodeId: string,
    type: VectorType,
    vector: Float32Array,
    meta: EmbedMeta,
  ): Promise<void> {
    this.assertVectorLength(vector, 'upsertEmbedding');
    if (meta.dimension !== this.dimension) {
      throw new Error(
        `upsertEmbedding: meta.dimension ${meta.dimension} != store dimension ${this.dimension}`,
      );
    }
    const table = type === 'content' ? 'vec_content' : 'vec_summary';
    const txn = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${table} WHERE node_id = ?`).run(nodeId);
      this.db
        .prepare(`INSERT INTO ${table} (node_id, embedding) VALUES (?, ?)`)
        .run(nodeId, vector);
      this.db
        .prepare(
          `INSERT INTO embedding_meta (node_id, vector_type, model, dimension, content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(node_id, vector_type) DO UPDATE SET
             model = excluded.model,
             dimension = excluded.dimension,
             content_hash = excluded.content_hash,
             created_at = datetime('now')`,
        )
        .run(nodeId, type, meta.model, meta.dimension, meta.contentHash);
    });
    txn();
  }

  async searchSummaryVectors(query: Float32Array, k: number): Promise<VectorMatch[]> {
    this.assertVectorLength(query, 'searchSummaryVectors');
    const rows = this.db
      .prepare(
        `SELECT node_id, distance FROM vec_summary
         WHERE embedding MATCH ?
           AND k = ?
         ORDER BY distance ASC`,
      )
      .all(query, k) as { node_id: string; distance: number }[];
    return rows.map((r) => ({ nodeId: r.node_id, score: r.distance }));
  }

  async searchContentVectors(
    query: Float32Array,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]> {
    this.assertVectorLength(query, 'searchContentVectors');
    let sql = `SELECT v.node_id, v.distance FROM vec_content v
      INNER JOIN nodes n ON n.id = v.node_id
      WHERE v.embedding MATCH ?
        AND k = ?`;
    const params: unknown[] = [query, k];
    if (filter?.noteIds?.length) {
      sql += ` AND n.note_id IN (${filter.noteIds.map(() => '?').join(',')})`;
      params.push(...filter.noteIds);
    }
    if (filter?.nodeTypes?.length) {
      sql += ` AND n.type IN (${filter.nodeTypes.map(() => '?').join(',')})`;
      params.push(...filter.nodeTypes);
    }
    sql += ` ORDER BY v.distance ASC`;
    const rows = this.db.prepare(sql).all(...params) as {
      node_id: string;
      distance: number;
    }[];
    return rows.map((r) => ({ nodeId: r.node_id, score: r.distance }));
  }

  async getAncestors(nodeId: string): Promise<DocumentNode[]> {
    const chain: DocumentNode[] = [];
    const select = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    const start = select.get(nodeId) as Record<string, unknown> | undefined;
    if (!start) return [];
    let parentId = start.parent_id as string | null;
    while (parentId) {
      const parent = select.get(parentId) as Record<string, unknown> | undefined;
      if (!parent) break;
      chain.push(rowToDocumentNode(parent));
      parentId = parent.parent_id as string | null;
    }
    return chain.reverse();
  }

  async getSiblings(nodeId: string): Promise<DocumentNode[]> {
    const self = this.db
      .prepare('SELECT parent_id, note_id FROM nodes WHERE id = ?')
      .get(nodeId) as { parent_id: string | null; note_id: string } | undefined;
    if (!self) return [];
    const rows =
      self.parent_id === null
        ? (this.db
            .prepare(
              `SELECT * FROM nodes
               WHERE parent_id IS NULL AND note_id = ? AND id != ?
               ORDER BY sibling_order ASC`,
            )
            .all(self.note_id, nodeId) as Record<string, unknown>[])
        : (this.db
            .prepare(
              `SELECT * FROM nodes
               WHERE parent_id = ? AND note_id = ? AND id != ?
               ORDER BY sibling_order ASC`,
            )
            .all(self.parent_id, self.note_id, nodeId) as Record<string, unknown>[]);
    return rows.map(rowToDocumentNode);
  }

  async getNoteMeta(noteId: string): Promise<NoteMeta | null> {
    const row = this.db.prepare('SELECT * FROM note_meta WHERE note_id = ?').get(noteId) as
      | {
          note_id: string;
          vault_path: string;
          content_hash: string;
          indexed_at: string;
          node_count: number;
        }
      | undefined;
    if (!row) return null;
    return {
      noteId: row.note_id,
      vaultPath: row.vault_path,
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
      nodeCount: row.node_count,
    };
  }

  async upsertNoteMeta(meta: NoteMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO note_meta (note_id, vault_path, content_hash, indexed_at, node_count)
         VALUES (@note_id, @vault_path, @content_hash, @indexed_at, @node_count)
         ON CONFLICT(note_id) DO UPDATE SET
           vault_path = excluded.vault_path,
           content_hash = excluded.content_hash,
           indexed_at = excluded.indexed_at,
           node_count = excluded.node_count`,
      )
      .run({
        note_id: meta.noteId,
        vault_path: meta.vaultPath,
        content_hash: meta.contentHash,
        indexed_at: meta.indexedAt,
        node_count: meta.nodeCount,
      });
  }
}
