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
const qv = new Float32Array(dim).fill(0.42);

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = path.join(rootDir, 'var/test/ret-4/fallback.db');

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

describe('SqliteDocumentStore RET-4 fallback (binding)', () => {
  it('Y3_fallback_hits_real_sqlite_S3_S4', async () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {
      /* best-effort */
    }
    const db = openDatabase(dbPath, { embeddingDimension: dim });
    loadSqliteVec(db);
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

    await store.upsertNodes([
      docNode({ id: 'sum1', noteId: 'n1', type: 'topic', content: 's1' }),
      docNode({ id: 'sum2', noteId: 'n2', type: 'topic', content: 's2' }),
      docNode({
        id: 'leafC',
        noteId: 'n3',
        parentId: null,
        type: 'paragraph',
        depth: 0,
        content: 'orphan content',
        contentHash: 'hc',
      }),
    ]);
    for (const [noteId, path] of [
      ['n1', 'a.md'],
      ['n2', 'b.md'],
      ['n3', 'c.md'],
    ] as const) {
      await store.upsertNoteMeta({
        noteId,
        vaultPath: path,
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
    }
    const em = { model: 'm', dimension: dim, contentHash: 'x' };
    await store.upsertEmbedding('sum1', 'summary', qv, em);
    await store.upsertEmbedding('sum2', 'summary', qv, em);
    await store.upsertEmbedding('leafC', 'content', qv, em);

    const embedder: IEmbeddingPort = {
      async embed() {
        return [qv];
      },
    };

    const res = await runSearch(
      { store, embedder },
      { query: 'find orphan', coarseK: 32, k: 10 },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    expect(res.results.map((r) => r.notePath)).toContain('c.md');
    expect(contentFilters.some((f) => !f?.subtreeRootNodeIds?.length)).toBe(true);
    db.close();
  });
});
