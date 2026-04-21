import { expect } from 'vitest';
import type { DocumentNode } from '@src/core/domain/types.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';

const DIM = 4;

function node(
  id: string,
  noteId: string,
  vaultPath: string,
  overrides: Partial<DocumentNode> = {},
): DocumentNode {
  return {
    id,
    noteId,
    parentId: null,
    type: 'topic',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'body',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function seedVec(
  store: IDocumentStore,
  nodeId: string,
  noteId: string,
  vaultPath: string,
  noteDate: string | null,
  q: Float32Array,
): Promise<void> {
  await store.upsertNodes([node(nodeId, noteId, vaultPath)]);
  await store.upsertNoteMeta({
    noteId,
    vaultPath,
    contentHash: 'hm',
    indexedAt: '2026-01-01T00:00:00.000Z',
    nodeCount: 1,
    noteDate,
  });
  await store.upsertEmbedding(nodeId, 'content', q, {
    model: 'm',
    dimension: DIM,
    contentHash: 'h',
  });
}

/** B1 — single path prefix scopes candidates (S5). */
export async function runB1SingleGlobContract(store: IDocumentStore): Promise<void> {
  const q = new Float32Array(DIM).fill(0.2);
  await seedVec(store, 'nW', 'nw', 'Work/x.md', null, q);
  await seedVec(store, 'nD', 'nd', 'Daily/2026-02-01.md', '2026-02-01', q);
  await seedVec(store, 'nR', 'nr', 'Research/y.md', null, q);
  const hits = await store.searchContentVectors(q, 8, { pathRegex: '^Daily/' });
  const ids = new Set(hits.map((h) => h.nodeId));
  expect(ids.has('nD')).toBe(true);
  expect(ids.has('nW')).toBe(false);
  expect(ids.has('nR')).toBe(false);
}

/** B2 — union regex (S6). */
export async function runB2UnionGlobsContract(store: IDocumentStore): Promise<void> {
  const q = new Float32Array(DIM).fill(0.21);
  await seedVec(store, 'a', 'na', 'Daily/a.md', null, q);
  await seedVec(store, 'b', 'nb', 'Journal/b.md', null, q);
  await seedVec(store, 'c', 'nc', 'Archive/c.md', null, q);
  const hits = await store.searchContentVectors(q, 8, {
    pathRegex: '^(?:Daily/.*|Journal/.*)$',
    pathLikes: ['Daily/%', 'Journal/%'],
  });
  const ids = new Set(hits.map((h) => h.nodeId));
  expect(ids.has('a')).toBe(true);
  expect(ids.has('b')).toBe(true);
  expect(ids.has('c')).toBe(false);
}

/** B3 — inclusive date range on note_date (S7). */
export async function runB3DateRangeInclusiveContract(store: IDocumentStore): Promise<void> {
  const q = new Float32Array(DIM).fill(0.22);
  await seedVec(store, 'e1', 'n1', 'Daily/a.md', '2026-01-31', q);
  await seedVec(store, 'e2', 'n2', 'Daily/b.md', '2026-02-15', q);
  await seedVec(store, 'e3', 'n3', 'Daily/c.md', '2026-03-01', q);
  const hits = await store.searchContentVectors(q, 8, {
    dateRange: { start: '2026-02-01', end: '2026-02-28' },
  });
  const ids = new Set(hits.map((h) => h.nodeId));
  expect(ids.has('e2')).toBe(true);
  expect(ids.has('e1')).toBe(false);
  expect(ids.has('e3')).toBe(false);
}

/** B4 — NULL note_date excluded when dateRange set (S8). */
export async function runB4NullNoteDateExcludedContract(store: IDocumentStore): Promise<void> {
  const q = new Float32Array(DIM).fill(0.23);
  await seedVec(store, 'p', 'np', 'Daily/x.md', null, q);
  const hits = await store.searchContentVectors(q, 8, {
    dateRange: { start: '2026-02-01', end: '2026-02-28' },
  });
  expect(hits.map((h) => h.nodeId)).not.toContain('p');
}

/** B5 — path ∧ date (S10). */
export async function runB5IntersectionContract(store: IDocumentStore): Promise<void> {
  const q = new Float32Array(DIM).fill(0.24);
  await seedVec(store, 'ok', 'nok', 'Daily/2026-02-14.md', '2026-02-14', q);
  await seedVec(store, 'bad1', 'nb1', 'Journal/2026-02-14.md', '2026-02-14', q);
  await seedVec(store, 'bad2', 'nb2', 'Daily/2026-04-01.md', '2026-04-01', q);
  const hits = await store.searchContentVectors(q, 8, {
    pathRegex: '^Daily/',
    pathLikes: ['Daily/%'],
    dateRange: { start: '2026-02-01', end: '2026-02-28' },
  });
  const ids = new Set(hits.map((h) => h.nodeId));
  expect(ids.has('ok')).toBe(true);
  expect(ids.has('bad1')).toBe(false);
  expect(ids.has('bad2')).toBe(false);
}

/** B6 — noteDate round-trip (S9). */
export async function runB6NoteDateRoundTripContract(store: IDocumentStore): Promise<void> {
  await store.upsertNodes([node('nm1', 'note_meta_rt', 'Daily/2026-02-01.md')]);
  await store.upsertNoteMeta({
    noteId: 'note_meta_rt',
    vaultPath: 'Daily/2026-02-01.md',
    contentHash: 'h',
    indexedAt: '2026-01-01T00:00:00.000Z',
    nodeCount: 1,
    noteDate: '2026-02-01',
  });
  const back = await store.getNoteMeta('note_meta_rt');
  expect(back?.noteDate).toBe('2026-02-01');
}
