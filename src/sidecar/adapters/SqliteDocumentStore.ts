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
import { sanitizeFtsQuery } from '../../core/domain/fts-sanitize.js';
import type { IDocumentStore } from '../../core/ports/IDocumentStore.js';
import Database from 'better-sqlite3';
import { getEmbeddingDimension } from '../db/migrate.js';

type SqliteDatabase = InstanceType<typeof Database>;

function dateRangeClause(
  metaAlias: string,
  dr: { start?: string; end?: string } | undefined,
): { sql: string; params: string[] } | null {
  if (!dr) return null;
  const hasStart = dr.start !== undefined && dr.start !== '';
  const hasEnd = dr.end !== undefined && dr.end !== '';
  if (!hasStart && !hasEnd) return null;
  const params: string[] = [];
  let sql = `${metaAlias}.note_date IS NOT NULL`;
  if (hasStart) {
    sql += ` AND ${metaAlias}.note_date >= ?`;
    params.push(dr.start!);
  }
  if (hasEnd) {
    sql += ` AND ${metaAlias}.note_date <= ?`;
    params.push(dr.end!);
  }
  return { sql: `(${sql})`, params };
}

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
    this.db.function('regexp', { deterministic: true }, (pattern: unknown, text: unknown) => {
      if (typeof pattern !== 'string' || typeof text !== 'string') return 0;
      try {
        return new RegExp(pattern).test(text) ? 1 : 0;
      } catch {
        return 0;
      }
    });
  }

  /** SQL `AND …` fragments for shared retrieval filters (excludes `subtreeRootNodeIds`). */
  static appendFilterWhere(
    nodeAlias: string,
    metaAlias: string,
    filter: NodeFilter | undefined,
  ): { sql: string; params: unknown[] } {
    let sql = '';
    const params: unknown[] = [];
    if (!filter) return { sql, params };
    if (filter.noteIds?.length) {
      sql += ` AND ${nodeAlias}.note_id IN (${filter.noteIds.map(() => '?').join(',')})`;
      params.push(...filter.noteIds);
    }
    if (filter.nodeTypes?.length) {
      sql += ` AND ${nodeAlias}.type IN (${filter.nodeTypes.map(() => '?').join(',')})`;
      params.push(...filter.nodeTypes);
    }
    if (filter.tagsAny?.length) {
      const lowered = filter.tagsAny.map((t) => t.toLowerCase());
      sql += ` AND EXISTS (SELECT 1 FROM tags t WHERE t.node_id = ${nodeAlias}.id AND lower(t.tag) IN (${lowered.map(() => '?').join(',')}))`;
      params.push(...lowered);
    }
    if (filter.pathLikes?.length) {
      const ph = filter.pathLikes.map(() => `${metaAlias}.vault_path LIKE ?`).join(' OR ');
      sql += ` AND (${ph})`;
      params.push(...filter.pathLikes);
    }
    if (filter.pathRegex) {
      sql += ` AND regexp(?, ${metaAlias}.vault_path) = 1`;
      params.push(filter.pathRegex);
    }
    const dr = dateRangeClause(metaAlias, filter.dateRange);
    if (dr) {
      sql += ` AND ${dr.sql}`;
      params.push(...dr.params);
    }
    return { sql, params };
  }

  private assertVectorLength(v: Float32Array, label: string): void {
    if (v.length !== this.dimension) {
      throw new Error(`${label}: expected length ${this.dimension}, got ${v.length}`);
    }
  }

  /** Inserts replace per-note; SQLite triggers mirror `nodes.content` into `nodes_fts` (STO-4). */
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
      const ins = this.db.prepare(`INSERT INTO tags (node_id, tag, source) VALUES (?, ?, ?)`);
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

  async getNodeById(nodeId: string): Promise<DocumentNode | null> {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return rowToDocumentNode(row);
  }

  async deleteNote(noteId: string): Promise<void> {
    this.db.prepare('DELETE FROM note_meta WHERE note_id = ?').run(noteId);
    this.db.prepare('DELETE FROM nodes WHERE note_id = ?').run(noteId);
  }

  async upsertSummary(
    nodeId: string,
    summary: string,
    model: string,
    promptVersion: string,
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO summaries (node_id, summary, model, prompt_version, generated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(node_id) DO UPDATE SET
           summary = excluded.summary,
           model = excluded.model,
           prompt_version = excluded.prompt_version,
           generated_at = datetime('now')`,
      )
      .run(nodeId, summary, model, promptVersion);
  }

  async getSummary(nodeId: string): Promise<StoredSummary | null> {
    const row = this.db
      .prepare(
        'SELECT summary, generated_at, model, prompt_version FROM summaries WHERE node_id = ?',
      )
      .get(nodeId) as
      | { summary: string; generated_at: string; model: string | null; prompt_version: string }
      | undefined;
    if (!row) return null;
    return {
      summary: row.summary,
      generatedAt: row.generated_at,
      model: row.model ?? null,
      promptVersion: row.prompt_version,
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

  async searchSummaryVectors(
    query: Float32Array,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]> {
    this.assertVectorLength(query, 'searchSummaryVectors');
    const { sql: filterSql, params: filterParams } = SqliteDocumentStore.appendFilterWhere(
      'n',
      'nm',
      filter,
    );
    const rows = this.db
      .prepare(
        `SELECT v.node_id, v.distance FROM vec_summary v
         INNER JOIN nodes n ON n.id = v.node_id
         INNER JOIN note_meta nm ON nm.note_id = n.note_id
         WHERE v.embedding MATCH ?
           AND k = ?
           ${filterSql}
         ORDER BY v.distance ASC`,
      )
      .all(query, k, ...filterParams) as { node_id: string; distance: number }[];
    return rows.map((r) => ({ nodeId: r.node_id, score: r.distance }));
  }

  async searchContentKeyword(query: string, k: number, filter?: NodeFilter): Promise<VectorMatch[]> {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) {
      return [];
    }
    const { sql: filterSql, params: filterParams } = SqliteDocumentStore.appendFilterWhere(
      'n',
      'nm',
      filter,
    );
    const rows = this.db
      .prepare(
        `SELECT n.id AS node_id, bm25(nodes_fts) AS score
         FROM nodes_fts
         INNER JOIN nodes n ON n.rowid = nodes_fts.rowid
         INNER JOIN note_meta nm ON nm.note_id = n.note_id
         WHERE nodes_fts MATCH ?
           ${filterSql}
         ORDER BY score ASC
         LIMIT ?`,
      )
      .all(sanitized, ...filterParams, k) as { node_id: string; score: number }[];
    return rows.map((r) => ({ nodeId: r.node_id, score: r.score }));
  }

  async searchContentVectors(
    query: Float32Array,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]> {
    this.assertVectorLength(query, 'searchContentVectors');
    const roots = filter?.subtreeRootNodeIds?.filter(Boolean) ?? [];
    const hasSubtree = roots.length > 0;

    const { sql: filterSql, params: filterParams } = SqliteDocumentStore.appendFilterWhere(
      'n',
      'nm',
      filter,
    );

    let sql: string;
    const params: unknown[] = [];

    if (hasSubtree) {
      const rootPh = roots.map(() => '?').join(', ');
      sql = `WITH RECURSIVE subtree(id) AS (
          SELECT id FROM nodes WHERE id IN (${rootPh})
          UNION ALL
          SELECT n.id FROM nodes n INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT v.node_id, v.distance FROM vec_content v
        INNER JOIN nodes n ON n.id = v.node_id
        INNER JOIN note_meta nm ON nm.note_id = n.note_id
        WHERE n.id IN (SELECT id FROM subtree)
          AND v.embedding MATCH ?
          AND k = ?`;
      params.push(...roots, query, k);
    } else {
      sql = `SELECT v.node_id, v.distance FROM vec_content v
        INNER JOIN nodes n ON n.id = v.node_id
        INNER JOIN note_meta nm ON nm.note_id = n.note_id
        WHERE v.embedding MATCH ?
          AND k = ?`;
      params.push(query, k);
    }

    sql += filterSql;
    params.push(...filterParams);
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
          note_date: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      noteId: row.note_id,
      vaultPath: row.vault_path,
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
      nodeCount: row.node_count,
      noteDate: row.note_date ?? null,
    };
  }

  async upsertNoteMeta(meta: NoteMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO note_meta (note_id, vault_path, content_hash, indexed_at, node_count, note_date)
         VALUES (@note_id, @vault_path, @content_hash, @indexed_at, @node_count, @note_date)
         ON CONFLICT(note_id) DO UPDATE SET
           vault_path = excluded.vault_path,
           content_hash = excluded.content_hash,
           indexed_at = excluded.indexed_at,
           node_count = excluded.node_count,
           note_date = excluded.note_date`,
      )
      .run({
        note_id: meta.noteId,
        vault_path: meta.vaultPath,
        content_hash: meta.contentHash,
        indexed_at: meta.indexedAt,
        node_count: meta.nodeCount,
        note_date: meta.noteDate ?? null,
      });
  }

  async noteMatchesTagFilter(noteId: string, tagsAny: string[]): Promise<boolean> {
    if (tagsAny.length === 0) return true;
    const lowered = tagsAny.map((t) => t.toLowerCase());
    const ph = lowered.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT EXISTS (
           SELECT 1 FROM tags t
           INNER JOIN nodes n ON n.id = t.node_id
           WHERE n.note_id = ? AND lower(t.tag) IN (${ph})
         ) AS ok`,
      )
      .get(noteId, ...lowered) as { ok: number };
    return row.ok === 1;
  }
}
