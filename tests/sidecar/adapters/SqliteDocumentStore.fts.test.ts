import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { DocumentNode, NodeFilter } from '@src/core/domain/types.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { loadSqliteVec } from '@src/sidecar/db/load-sqlite-vec.js';
import { openDatabase } from '@src/sidecar/db/open.js';

const dim = 4;
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dbPath = path.join(rootDir, 'var/test/ret5-hybrid.db');

function docNode(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: '',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function openRet5Db() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {
    /* best-effort */
  }
  const db = openDatabase(dbPath, { embeddingDimension: dim });
  loadSqliteVec(db);
  return db;
}

describe('SqliteDocumentStore FTS5 (RET-5)', () => {
  it('A1_bm25_results_real_fts5', async () => {
    const db = openRet5Db();
    const s = new SqliteDocumentStore(db);
    try {
      await s.upsertNodes([
        docNode({ id: 'a1', noteId: 'n1', type: 'topic', content: 'Acme Corp once' }),
        docNode({
          id: 'a2',
          noteId: 'n2',
          type: 'topic',
          content: 'Acme Corp Acme Corp Acme Corp many times',
        }),
        docNode({ id: 'a3', noteId: 'n3', type: 'topic', content: 'Acme Corp twice Acme Corp' }),
      ]);
      for (const row of [
        { noteId: 'n1', path: 'n1.md' },
        { noteId: 'n2', path: 'n2.md' },
        { noteId: 'n3', path: 'n3.md' },
      ] as const) {
        await s.upsertNoteMeta({
          noteId: row.noteId,
          vaultPath: row.path,
          contentHash: 'hx',
          indexedAt: '2026-01-01T00:00:00.000Z',
          nodeCount: 1,
        });
      }
      const hits = await s.searchContentKeyword('Acme Corp', 5);
      expect(hits[0]!.nodeId).toBe('a2');
    } finally {
      db.close();
    }
  });

  it('A2_sanitize_match_syntax', async () => {
    const db = openRet5Db();
    const s = new SqliteDocumentStore(db);
    try {
      await s.upsertNodes([
        docNode({ id: 'sx', noteId: 'ns', type: 'topic', content: 'safe token here' }),
      ]);
      await s.upsertNoteMeta({
        noteId: 'ns',
        vaultPath: 's.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
      const bad = ['a"b', 'a*b', 'a(b)', 'a:b', 'a-b', 'a^b'];
      for (const q of bad) {
        await expect(s.searchContentKeyword(q, 3)).resolves.toBeDefined();
      }
    } finally {
      db.close();
    }
  });

  it('A3_nodeTypes_filter_pushdown', async () => {
    const db = openRet5Db();
    const s = new SqliteDocumentStore(db);
    try {
      await s.upsertNodes([
        docNode({ id: 'p1', noteId: 'nx', type: 'topic', content: 'tokenx' }),
        docNode({
          id: 'p2',
          noteId: 'nx',
          parentId: 'p1',
          type: 'bullet',
          depth: 1,
          content: 'tokenx louder',
        }),
      ]);
      await s.upsertNoteMeta({
        noteId: 'nx',
        vaultPath: 'x.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
      });
      const hits = await s.searchContentKeyword('tokenx', 5, {
        nodeTypes: ['note', 'topic', 'subtopic'],
      });
      expect(hits.every((h) => h.nodeId === 'p1')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('Y3_bm25_plus_rrf_end_to_end_real_sqlite', async () => {
    const db = openRet5Db();
    const sqlite = new SqliteDocumentStore(db);
    try {
      const nodes: DocumentNode[] = [];
      for (let i = 0; i < 15; i++) {
        const id = `r${i}`;
        const noteId = `note${i}`;
        const content = i === 0 ? 'UniqueTokenXYZ alpha' : `other topic ${i} beta`;
        nodes.push(
          docNode({
            id,
            noteId,
            type: 'topic',
            content,
          }),
        );
      }
      nodes.push(
        docNode({
          id: 'leaf0',
          noteId: 'note0',
          parentId: 'r0',
          type: 'paragraph',
          depth: 1,
          content: 'body',
        }),
      );
      await sqlite.upsertNodes(nodes);
      for (let i = 0; i < 15; i++) {
        await sqlite.upsertNoteMeta({
          noteId: `note${i}`,
          vaultPath: `p${i}.md`,
          contentHash: 'hx',
          indexedAt: '2026-01-01T00:00:00.000Z',
          nodeCount: 2,
        });
      }
      const qNear = new Float32Array(dim).fill(0.5);
      const qFar = new Float32Array(dim).fill(0);
      const em = { model: 'm', dimension: dim, contentHash: 'e' };
      for (let i = 0; i < 15; i++) {
        await sqlite.upsertEmbedding(`r${i}`, 'summary', i === 0 ? qFar : qNear, em);
      }
      await sqlite.upsertEmbedding('leaf0', 'content', qNear, em);

      const embedder: IEmbeddingPort = {
        async embed() {
          return [qNear];
        },
      };

      const hybridOn = await runSearch(
        { store: sqlite, embedder },
        {
          query: 'UniqueTokenXYZ',
          coarseK: 8,
          k: 5,
          enableHybridSearch: true,
        },
        DEFAULT_SEARCH_ASSEMBLY,
      );
      expect(hybridOn.results.length).toBeGreaterThan(0);

      const vecOnly = await runSearch(
        { store: sqlite, embedder },
        {
          query: 'UniqueTokenXYZ',
          coarseK: 8,
          k: 5,
          enableHybridSearch: false,
        },
        DEFAULT_SEARCH_ASSEMBLY,
      );
      expect(vecOnly.results).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('Y4_hybrid_off_no_fts5_query', async () => {
    const db = openRet5Db();
    const inner = new SqliteDocumentStore(db);
    let bm25Calls = 0;
    const store = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'searchContentKeyword') {
          return async (q: string, k: number, f?: NodeFilter) => {
            bm25Calls += 1;
            return target.searchContentKeyword(q, k, f);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as IDocumentStore;
    try {
      const embedder: IEmbeddingPort = {
        async embed() {
          return [new Float32Array(dim).fill(0.2)];
        },
      };
      await runSearch(
        { store, embedder },
        { query: 'hello', coarseK: 8, enableHybridSearch: false },
        DEFAULT_SEARCH_ASSEMBLY,
      );
      expect(bm25Calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it('C5_fallback_preserves_filters_real_sqlite', async () => {
    const db = openRet5Db();
    const sqlite = new SqliteDocumentStore(db);
    const contentFilters: (NodeFilter | undefined)[] = [];
    const store = new Proxy(sqlite, {
      get(target, prop, receiver) {
        if (prop === 'searchContentVectors') {
          return async (q: Float32Array, k: number, f?: NodeFilter) => {
            contentFilters.push(f);
            return target.searchContentVectors(q, k, f);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as IDocumentStore;
    try {
      await store.upsertNodes([
        docNode({ id: 'fb1', noteId: 'nf1', type: 'topic', content: 'zzz' }),
      ]);
      await store.upsertNoteMeta({
        noteId: 'nf1',
        vaultPath: 'Daily/x.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
      const qv = new Float32Array(dim).fill(0.11);
      await store.upsertEmbedding('fb1', 'summary', qv, {
        model: 'm',
        dimension: dim,
        contentHash: 'c',
      });
      await store.upsertEmbedding('fb1', 'content', qv, {
        model: 'm',
        dimension: dim,
        contentHash: 'c',
      });
      const embedder: IEmbeddingPort = {
        async embed() {
          return [qv];
        },
      };
      await runSearch(
        { store, embedder },
        {
          query: 'nomatchphrase',
          coarseK: 32,
          enableHybridSearch: true,
          pathGlobs: ['Daily/*.md'],
        },
        DEFAULT_SEARCH_ASSEMBLY,
      );
      const fallback = contentFilters.find((f) => !f?.subtreeRootNodeIds?.length);
      expect(fallback?.pathGlobs).toEqual(['Daily/*.md']);
    } finally {
      db.close();
    }
  });
});
