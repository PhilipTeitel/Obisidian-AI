import { describe, expect, it } from 'vitest';
import type { DocumentNode } from '@src/core/domain/types.js';
import { SUMMARY_RUBRIC_VERSION } from '@src/core/domain/summaryPrompts.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';

function sampleNode(overrides: Partial<DocumentNode> = {}): DocumentNode {
  return {
    id: 'n_contract',
    noteId: 'note_contract',
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'contract body',
    contentHash: 'h_contract',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const EMBED_DIM = 4;

/** RET-4 / ADR-012: unrestricted `searchContentVectors` (no `subtreeRootNodeIds`) must return ANN rows. */
export async function assertUnrestrictedContentSearchContract(store: IDocumentStore): Promise<void> {
  const q = new Float32Array(EMBED_DIM).fill(0.15);
  await store.upsertNodes([
    sampleNode({ id: 'ctr_a', noteId: 'note_ctr_a', type: 'topic' }),
    sampleNode({
      id: 'ctr_b',
      noteId: 'note_ctr_a',
      parentId: 'ctr_a',
      type: 'paragraph',
      depth: 1,
      content: 'leaf body',
    }),
  ]);
  const meta = {
    model: 'm',
    dimension: EMBED_DIM,
    contentHash: 'h_ctr',
  };
  await store.upsertEmbedding('ctr_a', 'summary', q, meta);
  await store.upsertEmbedding('ctr_b', 'content', q, meta);

  const scoped = await store.searchContentVectors(q, 8, { subtreeRootNodeIds: ['ctr_a'] });
  const unrestricted = await store.searchContentVectors(q, 8);
  expect(scoped.length).toBeGreaterThan(0);
  expect(unrestricted.length).toBeGreaterThan(0);
  const ids = new Set(unrestricted.map((m) => m.nodeId));
  expect(ids.size).toBe(unrestricted.length);
}

/** Port-level round-trip used by adapter integration tests (STO-4 Y8). */
export async function runDocumentStoreContractRoundTrip(store: IDocumentStore): Promise<void> {
  await store.upsertNodes([sampleNode()]);
  const nodes = await store.getNodesByNote('note_contract');
  expect(nodes).toHaveLength(1);
  expect(nodes[0]!.content).toBe('contract body');

  await store.upsertSummary('n_contract', 'summary text', 'model-x', SUMMARY_RUBRIC_VERSION);
  const sum = await store.getSummary('n_contract');
  expect(sum?.summary).toBe('summary text');
  expect(sum?.model).toBe('model-x');
  expect(sum?.promptVersion).toBe(SUMMARY_RUBRIC_VERSION);

  await store.upsertNoteMeta({
    noteId: 'note_contract',
    vaultPath: 'vault/path.md',
    contentHash: 'h_meta',
    indexedAt: '2026-02-01T00:00:00.000Z',
    nodeCount: 5,
  });
  const meta = await store.getNoteMeta('note_contract');
  expect(meta?.vaultPath).toBe('vault/path.md');
  expect(meta?.nodeCount).toBe(5);
}

describe('IDocumentStore contract', () => {
  it('contract_round_trip', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: 4 });
    const store = new SqliteDocumentStore(db);
    try {
      await runDocumentStoreContractRoundTrip(store);
    } finally {
      db.close();
    }
  });

  it('Y8_unrestricted_content_search_contract', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: EMBED_DIM });
    const store = new SqliteDocumentStore(db);
    try {
      await assertUnrestrictedContentSearchContract(store);
    } finally {
      db.close();
    }
  });
});
