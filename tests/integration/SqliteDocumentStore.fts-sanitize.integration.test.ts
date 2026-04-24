import { describe, expect, it, vi } from 'vitest';
import type { DocumentNode } from '@src/core/domain/types.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { loadSqliteVec } from '@src/sidecar/db/load-sqlite-vec.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';

const dim = 4;

function docNode(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'topic',
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

describe('SqliteDocumentStore FTS sanitize (BUG-4 integration)', () => {
  it('Y3_real_fts_no_syntax_error', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: dim });
    loadSqliteVec(db);
    const store = new SqliteDocumentStore(db);
    try {
      await store.upsertNodes([
        docNode({
          id: 'n1',
          noteId: 'note1',
          content: 'Yesterday I wrote code and planned the sprint.',
        }),
      ]);
      await store.upsertNoteMeta({
        noteId: 'note1',
        vaultPath: 'daily/2026-04-23.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
      const hits = await store.searchContentKeyword('What did I do yesterday?', 10);
      expect(Array.isArray(hits)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('Y4_backticks_and_punctuation', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: dim });
    loadSqliteVec(db);
    const store = new SqliteDocumentStore(db);
    try {
      await store.upsertNodes([
        docNode({ id: 'b1', noteId: 'nb', content: 'Run the foo command on bar.' }),
      ]);
      await store.upsertNoteMeta({
        noteId: 'nb',
        vaultPath: 'cmd.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
      const hits = await store.searchContentKeyword('`foo` bar?', 10);
      expect(Array.isArray(hits)).toBe(true);
      expect(hits.some((h) => h.nodeId === 'b1')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('Y5_zero_token_short_circuit', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: dim });
    loadSqliteVec(db);
    const store = new SqliteDocumentStore(db);
    try {
      await store.upsertNodes([
        docNode({ id: 'z1', noteId: 'nz', content: 'seed so fts table is non-empty' }),
      ]);
      await store.upsertNoteMeta({
        noteId: 'nz',
        vaultPath: 'z.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
      const prepareSpy = vi.spyOn(db, 'prepare');
      const hits = await store.searchContentKeyword('??!!', 10);
      expect(hits).toEqual([]);
      const ftsPrepareCalls = prepareSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('nodes_fts MATCH'),
      );
      expect(ftsPrepareCalls.length).toBe(0);
      prepareSpy.mockRestore();
    } finally {
      db.close();
    }
  });
});
