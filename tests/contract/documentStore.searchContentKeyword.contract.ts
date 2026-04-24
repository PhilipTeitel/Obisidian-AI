import { describe, expect, it } from 'vitest';
import { buildFtsMatchQuery } from '@src/core/domain/fts-sanitize.js';
import type {
  DocumentNode,
  EmbedMeta,
  NodeFilter,
  NoteMeta,
  ParsedCrossRef,
  ParsedTag,
  VectorMatch,
  VectorType,
} from '@src/core/domain/types.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { loadSqliteVec } from '@src/sidecar/db/load-sqlite-vec.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';

const EMBED_DIM = 4;

function sampleNode(overrides: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
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
    ...overrides,
  };
}

/**
 * In-memory {@link IDocumentStore} that mirrors `buildFtsMatchQuery` + BM25-ish ranking for contract tests.
 */
class KeywordContractMemoryStore implements IDocumentStore {
  private nodes: DocumentNode[] = [];

  async upsertNodes(nodes: DocumentNode[]): Promise<void> {
    for (const n of nodes) {
      const idx = this.nodes.findIndex((x) => x.id === n.id);
      if (idx >= 0) this.nodes[idx] = n;
      else this.nodes.push(n);
    }
  }

  async replaceNoteTags(_noteId: string, _tags: ParsedTag[]): Promise<void> {}
  async replaceNoteCrossRefs(_noteId: string, _refs: ParsedCrossRef[]): Promise<void> {}
  async getNodesByNote(_noteId: string): Promise<DocumentNode[]> {
    return [];
  }
  async getNodeById(_nodeId: string): Promise<DocumentNode | null> {
    return null;
  }
  async deleteNote(_noteId: string): Promise<void> {}
  async upsertSummary(
    _nodeId: string,
    _summary: string,
    _model: string,
    _promptVersion: string,
  ): Promise<void> {}
  async getSummary(_nodeId: string): Promise<null> {
    return null;
  }
  async getEmbeddingMeta(_nodeId: string, _vectorType: VectorType): Promise<EmbedMeta | null> {
    return null;
  }
  async upsertEmbedding(
    _nodeId: string,
    _type: VectorType,
    _vector: Float32Array,
    _meta: EmbedMeta,
  ): Promise<void> {}

  async searchSummaryVectors(): Promise<VectorMatch[]> {
    return [];
  }

  async searchContentKeyword(
    query: string,
    k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]> {
    const expr = buildFtsMatchQuery(query);
    if (expr === null) return [];
    const terms = expr.split(' OR ').map((p) => {
      const inner = p.slice(1, -1);
      return inner.replace(/""/g, '"');
    });
    let list = this.nodes;
    if (filter?.nodeTypes?.length) {
      list = list.filter((n) => filter.nodeTypes!.includes(n.type));
    }
    const scored: VectorMatch[] = [];
    for (const n of list) {
      const text = n.content.toLowerCase();
      let occ = 0;
      for (const t of terms) {
        const tl = t.toLowerCase();
        if (tl.length === 0) continue;
        occ += text.split(tl).length - 1;
      }
      if (occ > 0) {
        scored.push({ nodeId: n.id, score: 1 / (1 + occ) });
      }
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, k);
  }

  async searchContentVectors(): Promise<VectorMatch[]> {
    return [];
  }
  async getAncestors(_nodeId: string): Promise<DocumentNode[]> {
    return [];
  }
  async getSiblings(_nodeId: string): Promise<DocumentNode[]> {
    return [];
  }
  async getNoteMeta(_noteId: string): Promise<NoteMeta | null> {
    return null;
  }
  async upsertNoteMeta(_meta: NoteMeta): Promise<void> {}
  async noteMatchesTagFilter(_noteId: string, _tagsAny: string[]): Promise<boolean> {
    return true;
  }
}

export async function Y1_punctuation_only_returns_empty(store: IDocumentStore): Promise<void> {
  expect(await store.searchContentKeyword('??!!...', 10)).toEqual([]);
  expect(await store.searchContentKeyword('   \t', 10)).toEqual([]);
  expect(await store.searchContentKeyword('```', 10)).toEqual([]);
}

export async function Y1_common_punctuation_no_throw(store: IDocumentStore): Promise<void> {
  const queries = ['?', '!', '.', '`', '?!.', 'hello?', 'use `x` now!', '…'];
  for (const q of queries) {
    await expect(store.searchContentKeyword(q, 5)).resolves.toBeDefined();
  }
}

export async function Y2_keyword_input_returns_hits(store: IDocumentStore): Promise<void> {
  await store.upsertNodes([
    sampleNode({ id: 'k1', noteId: 'nk1', type: 'topic', content: 'Acme Corp appears once' }),
    sampleNode({
      id: 'k2',
      noteId: 'nk2',
      type: 'topic',
      content: 'Acme Corp Acme Corp Acme Corp repeated',
    }),
    sampleNode({
      id: 'kb',
      noteId: 'nk1',
      parentId: 'k1',
      type: 'bullet',
      depth: 1,
      content: 'Acme Corp bullet noise',
    }),
  ]);
  for (const row of [
    { noteId: 'nk1', path: 'one.md' },
    { noteId: 'nk2', path: 'two.md' },
  ] as const) {
    await store.upsertNoteMeta({
      noteId: row.noteId,
      vaultPath: row.path,
      contentHash: 'hm',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 2,
    });
  }
  const hits = await store.searchContentKeyword('Acme Corp', 10, {
    nodeTypes: ['note', 'topic', 'subtopic'],
  });
  const ids = hits.map((h) => h.nodeId);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids).not.toContain('kb');
  expect(ids).toContain('k2');
  expect(ids).toContain('k1');
  expect(ids.indexOf('k2')).toBeLessThan(ids.indexOf('k1'));
  for (let i = 1; i < hits.length; i++) {
    expect(hits[i - 1]!.score).toBeLessThanOrEqual(hits[i]!.score);
  }
}

describe('IDocumentStore.searchContentKeyword contract (BUG-4)', () => {
  it('Y1_punctuation_only_returns_empty_memory', async () => {
    await Y1_punctuation_only_returns_empty(new KeywordContractMemoryStore());
  });

  it('Y1_punctuation_only_returns_empty_sqlite', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: EMBED_DIM });
    loadSqliteVec(db);
    const store = new SqliteDocumentStore(db);
    try {
      await Y1_punctuation_only_returns_empty(store);
    } finally {
      db.close();
    }
  });

  it('Y1_common_punctuation_no_throw_memory', async () => {
    await Y1_common_punctuation_no_throw(new KeywordContractMemoryStore());
  });

  it('Y1_common_punctuation_no_throw_sqlite', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: EMBED_DIM });
    loadSqliteVec(db);
    const store = new SqliteDocumentStore(db);
    try {
      await store.upsertNodes([
        sampleNode({ id: 'sx', noteId: 'ns', type: 'topic', content: 'hello world token' }),
      ]);
      await store.upsertNoteMeta({
        noteId: 'ns',
        vaultPath: 's.md',
        contentHash: 'hx',
        indexedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 1,
      });
      await Y1_common_punctuation_no_throw(store);
    } finally {
      db.close();
    }
  });

  it('Y2_keyword_input_returns_hits_memory', async () => {
    await Y2_keyword_input_returns_hits(new KeywordContractMemoryStore());
  });

  it('Y2_keyword_input_returns_hits_sqlite', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: EMBED_DIM });
    loadSqliteVec(db);
    const store = new SqliteDocumentStore(db);
    try {
      await Y2_keyword_input_returns_hits(store);
    } finally {
      db.close();
    }
  });
});
