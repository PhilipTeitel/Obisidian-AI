import { describe, expect, it } from 'vitest';
import type { DocumentNode } from '../../core/domain/types.js';
import { openMigratedMemoryDb } from '../db/open.js';
import { SqliteDocumentStore } from './SqliteDocumentStore.js';

const DIM = 4;

function makeStore(): { store: SqliteDocumentStore; db: ReturnType<typeof openMigratedMemoryDb> } {
  const db = openMigratedMemoryDb({ embeddingDimension: DIM });
  return { store: new SqliteDocumentStore(db), db };
}

function baseNode(
  overrides: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>,
): DocumentNode {
  return {
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'c',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteDocumentStore', () => {
  it('A1_nodes_roundtrip', async () => {
    const { store: s } = makeStore();
    const nodes: DocumentNode[] = [
      baseNode({
        id: 'n1',
        noteId: 'note1',
        headingTrail: ['H1'],
        content: 'hello',
      }),
    ];
    await s.upsertNodes(nodes);
    const back = await s.getNodesByNote('note1');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      id: 'n1',
      noteId: 'note1',
      headingTrail: ['H1'],
      content: 'hello',
    });
  });

  it('A2_delete_note_cascade', async () => {
    const { store: s, db } = makeStore();
    const nodes = [
      baseNode({ id: 'n1', noteId: 'note1' }),
      baseNode({
        id: 'n2',
        noteId: 'note1',
        parentId: 'n1',
        type: 'paragraph',
        depth: 1,
        siblingOrder: 0,
      }),
    ];
    await s.upsertNodes(nodes);
    db.prepare(`INSERT INTO tags (node_id, tag, source) VALUES ('n2','t','inline')`).run();
    db.prepare(
      `INSERT INTO cross_refs (source_node_id, target_path) VALUES ('n2','other.md')`,
    ).run();
    await s.upsertSummary('n2', 'sum', 'm');
    await s.upsertNoteMeta({
      noteId: 'note1',
      vaultPath: 'a.md',
      contentHash: 'h',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 2,
    });
    const v = new Float32Array(DIM).fill(0.1);
    await s.upsertEmbedding('n2', 'content', v, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h',
    });
    await s.deleteNote('note1');
    const empty = await s.getNodesByNote('note1');
    expect(empty).toHaveLength(0);
    expect(await s.getNoteMeta('note1')).toBeNull();
    const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags').get() as {
      c: number;
    };
    expect(tagCount.c).toBe(0);
    const xrefCount = db.prepare('SELECT COUNT(*) as c FROM cross_refs').get() as {
      c: number;
    };
    expect(xrefCount.c).toBe(0);
    const metaCount = db.prepare('SELECT COUNT(*) as c FROM embedding_meta').get() as {
      c: number;
    };
    expect(metaCount.c).toBe(0);
  });

  it('A1_tags_xrefs_replace', async () => {
    const { store: s, db } = makeStore();
    await s.upsertNodes([
      baseNode({ id: 'tn1', noteId: 'note-tx' }),
      baseNode({
        id: 'tn2',
        noteId: 'note-tx',
        parentId: 'tn1',
        type: 'paragraph',
        depth: 1,
        siblingOrder: 0,
        content: 'c',
      }),
    ]);
    await s.replaceNoteTags('note-tx', [
      { nodeId: 'tn2', tag: 't1', source: 'inline' },
      { nodeId: 'tn2', tag: 't2', source: 'inline' },
    ]);
    await s.replaceNoteCrossRefs('note-tx', [
      { sourceNodeId: 'tn2', targetPath: 'other.md', linkText: 'L' },
    ]);
    const tagRows = db.prepare('SELECT tag FROM tags ORDER BY tag').all() as { tag: string }[];
    expect(tagRows.map((r) => r.tag)).toEqual(['t1', 't2']);
    const xref = db.prepare('SELECT target_path FROM cross_refs').all() as { target_path: string }[];
    expect(xref.map((r) => r.target_path)).toEqual(['other.md']);
    await s.replaceNoteTags('note-tx', []);
    await s.replaceNoteCrossRefs('note-tx', []);
    const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number };
    expect(tagCount.c).toBe(0);
    const xrefCount = db.prepare('SELECT COUNT(*) as c FROM cross_refs').get() as { c: number };
    expect(xrefCount.c).toBe(0);
  });

  it('A1_getSummary_roundtrip', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([baseNode({ id: 'sn1', noteId: 'note1' })]);
    await s.upsertSummary('sn1', 'hello summary', 'gpt-test');
    const got = await s.getSummary('sn1');
    expect(got).not.toBeNull();
    expect(got!.summary).toBe('hello summary');
    expect(got!.model).toBe('gpt-test');
    expect(got!.generatedAt).toMatch(/\d{4}/);
    const missing = await s.getSummary('no-such');
    expect(missing).toBeNull();
  });

  it('A2_get_embedding_meta', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([baseNode({ id: 'en1', noteId: 'note1' })]);
    const v = new Float32Array(DIM).fill(0.3);
    await s.upsertEmbedding('en1', 'content', v, {
      model: 'emb-m',
      dimension: DIM,
      contentHash: 'ch-xyz',
    });
    const meta = await s.getEmbeddingMeta('en1', 'content');
    expect(meta).toMatchObject({
      model: 'emb-m',
      dimension: DIM,
      contentHash: 'ch-xyz',
    });
    expect(await s.getEmbeddingMeta('en1', 'summary')).toBeNull();
    expect(await s.getEmbeddingMeta('missing', 'content')).toBeNull();
  });

  it('A3_summary_note_meta', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([baseNode({ id: 'n1', noteId: 'note1' })]);
    await s.upsertSummary('n1', 'text', 'model-x');
    await s.upsertNoteMeta({
      noteId: 'note1',
      vaultPath: 'p.md',
      contentHash: 'ch',
      indexedAt: '2026-02-01T00:00:00.000Z',
      nodeCount: 3,
    });
    const meta = await s.getNoteMeta('note1');
    expect(meta).toMatchObject({
      noteId: 'note1',
      vaultPath: 'p.md',
      contentHash: 'ch',
      nodeCount: 3,
    });
  });

  it('B1_summary_ann', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([
      baseNode({ id: 'a', noteId: 'n' }),
      baseNode({
        id: 'b',
        noteId: 'n',
        parentId: 'a',
        type: 'paragraph',
        depth: 1,
        siblingOrder: 0,
      }),
    ]);
    const far = new Float32Array(DIM).fill(0);
    const near = new Float32Array(DIM).fill(1);
    await s.upsertEmbedding('a', 'summary', far, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h1',
    });
    await s.upsertEmbedding('b', 'summary', near, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h2',
    });
    const q = new Float32Array(DIM).fill(0.95);
    const hits = await s.searchSummaryVectors(q, 2);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(hits[0].score)).toBe(true);
    expect(hits[0].nodeId).toBe('b');
  });

  it('B2_content_filter_note_ids', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([baseNode({ id: 'n1', noteId: 'A' }), baseNode({ id: 'n2', noteId: 'B' })]);
    const v1 = new Float32Array(DIM).fill(0.5);
    await s.upsertEmbedding('n1', 'content', v1, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h',
    });
    await s.upsertEmbedding('n2', 'content', v1, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h',
    });
    const q = new Float32Array(DIM).fill(0.5);
    const hits = await s.searchContentVectors(q, 5, { noteIds: ['A'] });
    expect(hits.every((h) => h.nodeId === 'n1')).toBe(true);
  });

  it('B3_content_filter_node_types', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([
      baseNode({ id: 'n1', noteId: 'A' }),
      baseNode({
        id: 'n2',
        noteId: 'A',
        parentId: 'n1',
        type: 'paragraph',
        depth: 1,
        siblingOrder: 0,
      }),
    ]);
    const v = new Float32Array(DIM).fill(0.2);
    await s.upsertEmbedding('n1', 'content', v, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h',
    });
    await s.upsertEmbedding('n2', 'content', v, {
      model: 'm',
      dimension: DIM,
      contentHash: 'h',
    });
    const q = new Float32Array(DIM).fill(0.2);
    const hits = await s.searchContentVectors(q, 5, {
      nodeTypes: ['paragraph'],
    });
    expect(hits.every((h) => h.nodeId === 'n2')).toBe(true);
  });

  it('C1_ancestors', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([
      baseNode({ id: 'r', noteId: 'n' }),
      baseNode({
        id: 'c',
        noteId: 'n',
        parentId: 'r',
        type: 'topic',
        depth: 1,
        siblingOrder: 0,
      }),
      baseNode({
        id: 'l',
        noteId: 'n',
        parentId: 'c',
        type: 'paragraph',
        depth: 2,
        siblingOrder: 0,
      }),
    ]);
    const anc = await s.getAncestors('l');
    expect(anc.map((a) => a.id)).toEqual(['r', 'c']);
  });

  it('C2_siblings', async () => {
    const { store: s } = makeStore();
    await s.upsertNodes([
      baseNode({ id: 'r', noteId: 'n' }),
      baseNode({
        id: 'a',
        noteId: 'n',
        parentId: 'r',
        type: 'paragraph',
        depth: 1,
        siblingOrder: 0,
      }),
      baseNode({
        id: 'b',
        noteId: 'n',
        parentId: 'r',
        type: 'paragraph',
        depth: 1,
        siblingOrder: 1,
      }),
    ]);
    const sib = await s.getSiblings('a');
    expect(sib.map((x) => x.id)).toEqual(['b']);
  });

  it('Y2_adapter_path', () => {
    expect(import.meta.url).toContain('/sidecar/adapters/');
  });
});
