import { describe, expect, it } from 'vitest';
import type { DocumentNode } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import type { RetrievalPlan } from '@src/core/domain/agentRetrievalPlan.js';
import { AgentNoteToolRunner } from '@src/core/workflows/AgentNoteToolRunner.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

function seedNode(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'paragraph',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'body',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function plan(): RetrievalPlan {
  return {
    planVersion: 'v1',
    status: 'ready',
    task: 'Compile',
    topic: 'job search',
    entities: [],
    filters: {
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
      tags: ['career'],
    },
    output: { kind: 'draft_note', defaultFormat: 'bullet_list' },
    toolCalls: [
      { id: 'search_notes-1', type: 'search_notes', reason: 'Search', query: 'job search' },
      { id: 'read_note-1', type: 'read_note', reason: 'Read' },
    ],
    stablePlanKey: 'agent-plan:v1:integration',
  };
}

async function sqliteStoreWithTwoNotes(): Promise<SqliteDocumentStore> {
  const store = new SqliteDocumentStore(openMigratedMemoryDb({ embeddingDimension: 4 }));
  const dailyPath = 'Daily/2026-04-10.md';
  const projectPath = 'Projects/job-search.md';
  await store.upsertNodes([
    seedNode({
      id: 'daily-hit',
      noteId: dailyPath,
      type: 'note',
      content: 'Daily job search application',
      headingTrail: ['Daily'],
    }),
    seedNode({
      id: 'project-filtered',
      noteId: projectPath,
      type: 'note',
      content: 'Project job search note outside date scope',
      headingTrail: ['Project'],
    }),
  ]);
  await store.upsertNoteMeta({
    noteId: dailyPath,
    vaultPath: dailyPath,
    contentHash: 'x',
    indexedAt: '2026-01-01T00:00:00.000Z',
    nodeCount: 1,
    noteDate: '2026-04-10',
  });
  await store.upsertNoteMeta({
    noteId: projectPath,
    vaultPath: projectPath,
    contentHash: 'y',
    indexedAt: '2026-01-01T00:00:00.000Z',
    nodeCount: 1,
    noteDate: undefined,
  });
  await store.replaceNoteTags(dailyPath, [{ nodeId: 'daily-hit', tag: 'career', source: 'inline' }]);
  await store.replaceNoteTags(projectPath, [{ nodeId: 'project-filtered', tag: 'career', source: 'inline' }]);
  const vector = new Float32Array(4).fill(0.5);
  for (const nodeId of ['daily-hit', 'project-filtered']) {
    await store.upsertEmbedding(nodeId, 'summary', vector, {
      model: 'test',
      dimension: 4,
      contentHash: nodeId,
    });
    await store.upsertEmbedding(nodeId, 'content', vector, {
      model: 'test',
      dimension: 4,
      contentHash: nodeId,
    });
  }
  return store;
}

describe('agent note tools integration (AGT-3)', () => {
  // @scenario S3
  it('B4_search_notes_uses_searchworkflow_filters_and_hybrid', async () => {
    const store = await sqliteStoreWithTwoNotes();
    const p = plan();
    const result = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[0]!,
      priorResults: [],
      enableHybridSearch: true,
      coarseK: 8,
      k: 4,
    });

    expect(result.type).toBe('search_notes');
    if (result.type === 'search_notes') {
      expect(result.results.map((item) => item.nodeId)).toEqual(['daily-hit']);
      expect(result.sources).toEqual([{ notePath: 'Daily/2026-04-10.md', nodeId: 'daily-hit' }]);
    }
  });

  // @scenario S3
  it('C3_read_note_filters_and_sources_indexed_nodes', async () => {
    const store = await sqliteStoreWithTwoNotes();
    const p = plan();
    const result = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: { ...p.toolCalls[1]!, nodeIds: ['project-filtered', 'daily-hit', 'daily-hit'] },
      priorResults: [],
    });

    expect(result.type).toBe('read_note');
    if (result.type === 'read_note') {
      expect(result.status).toBe('ok');
      expect(result.nodes.map((node) => node.nodeId)).toEqual(['daily-hit']);
      expect(result.sources).toEqual([{ notePath: 'Daily/2026-04-10.md', nodeId: 'daily-hit' }]);
      expect(result.usedNodes).toEqual([{ nodeId: 'daily-hit', notePath: 'Daily/2026-04-10.md', insertionOrder: 0 }]);
    }
  });
});
