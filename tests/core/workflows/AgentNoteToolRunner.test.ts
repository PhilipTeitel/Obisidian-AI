import { describe, expect, it } from 'vitest';
import type { DocumentNode } from '@src/core/domain/types.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { AgentNoteToolRunner } from '@src/core/workflows/AgentNoteToolRunner.js';
import type { RetrievalPlan } from '@src/core/domain/agentRetrievalPlan.js';
import { AGENT_NOTE_TOOL_BUDGETS, type AgentNoteToolResult } from '@src/core/domain/agentNoteTools.js';
import { SearchTestStore } from './searchTestStore.js';

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
    task: 'Summarize',
    topic: 'job search',
    entities: ['applications'],
    filters: {
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
      tags: ['career'],
    },
    output: { kind: 'draft_note', requestedFormat: 'table', defaultFormat: 'bullet_list' },
    toolCalls: [
      { id: 'search_notes-1', type: 'search_notes', reason: 'Search notes', query: 'job search' },
      { id: 'read_note-1', type: 'read_note', reason: 'Read result' },
      { id: 'assemble_draft-1', type: 'assemble_draft', reason: 'Assemble draft' },
    ],
    stablePlanKey: 'agent-plan:v1:runner',
  };
}

function configuredStore(): SearchTestStore {
  const store = new SearchTestStore();
  store.nodes.set(
    'leaf',
    seedNode({
      id: 'leaf',
      noteId: 'Daily/2026-04-10.md',
      content: 'Applied to Acme and booked an interview',
      headingTrail: ['Job Search'],
    }),
  );
  store.meta.set('Daily/2026-04-10.md', {
    noteId: 'Daily/2026-04-10.md',
    vaultPath: 'Daily/2026-04-10.md',
    contentHash: 'x',
    indexedAt: '2026-01-01T00:00:00.000Z',
    nodeCount: 1,
    noteDate: '2026-04-10',
  });
  store.summaryHits = [{ nodeId: 'leaf', score: 0.1 }];
  store.keywordHits = [{ nodeId: 'leaf', score: 0.2 }];
  store.contentHits = [{ nodeId: 'leaf', score: 0.05 }];
  return store;
}

describe('AgentNoteToolRunner (AGT-3)', () => {
  // @scenario S3
  it('B1_search_notes_delegates_to_search_workflow', async () => {
    const store = configuredStore();
    const p = plan();
    const result = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[0]!,
      priorResults: [],
      coarseK: 7,
      k: 5,
      enableHybridSearch: true,
    });

    expect(result.type).toBe('search_notes');
    expect(store.callLog).toContain('searchSummaryVectors');
    expect(store.callLog).toContain('searchContentKeyword');
    expect(store.callLog).toContain('searchContentVectors');
    expect(store.lastKeywordQuery).toBe('job search');
    expect(store.lastSummaryK).toBe(7);
    expect(store.lastContentFilter?.dateRange).toEqual({ start: '2026-04-01', end: '2026-04-30' });
    expect(result.sources).toEqual([{ notePath: 'Daily/2026-04-10.md', nodeId: 'leaf' }]);
  });

  // @scenario S3
  it('B2_search_inherits_plan_scope', async () => {
    const store = configuredStore();
    const p = plan();
    await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: { ...p.toolCalls[0]!, pathGlobs: ['Other/**/*.md'], tags: ['other'] },
      priorResults: [],
    });

    expect(store.lastContentFilter?.pathLikes).toEqual(['Daily/%.md']);
    expect(store.lastContentFilter?.tagsAny).toEqual(['career']);
  });

  // @scenario S3
  it('C1_read_note_uses_document_store', async () => {
    const store = configuredStore();
    const p = plan();
    const result = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: { ...p.toolCalls[1]!, notePath: 'Daily/2026-04-10.md' },
      priorResults: [],
    });

    expect(result.type).toBe('read_note');
    if (result.type === 'read_note') {
      expect(result.status).toBe('ok');
      expect(result.nodes).toEqual([
        {
          nodeId: 'leaf',
          notePath: 'Daily/2026-04-10.md',
          content: 'Applied to Acme and booked an interview',
          headingTrail: ['Job Search'],
        },
      ]);
      expect(result.sources).toEqual([{ notePath: 'Daily/2026-04-10.md', nodeId: 'leaf' }]);
    }
  });

  // @scenario S3
  it('C2_read_note_missing_target_fails_closed', async () => {
    const store = configuredStore();
    const p = plan();
    const result = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[1]!,
      priorResults: [],
    });

    expect(result.type).toBe('read_note');
    expect(result.status).toBe('needs_target');
    expect(result.sources).toEqual([]);
    expect(store.callLog).not.toContain('searchSummaryVectors');
  });

  // @scenario S4
  it('D1_assemble_draft_uses_prior_tool_outputs', async () => {
    const store = configuredStore();
    const p = plan();
    const searchResult = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[0]!,
      priorResults: [],
    });
    const result = await new AgentNoteToolRunner({ store, embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[2]!,
      priorResults: [searchResult],
    });

    expect(result.type).toBe('assemble_draft');
    if (result.type === 'assemble_draft') {
      expect(result.draftMarkdown).toContain('# Draft: job search');
      expect(result.draftMarkdown).toContain('Daily/2026-04-10.md#leaf');
      expect(result.sources).toEqual([{ notePath: 'Daily/2026-04-10.md', nodeId: 'leaf' }]);
    }
  });

  // @scenario S4
  it('D3_assemble_draft_carries_output_intent', async () => {
    const p = plan();
    const result = await new AgentNoteToolRunner({ store: configuredStore(), embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[2]!,
      priorResults: [],
    });

    expect(result.type).toBe('assemble_draft');
    if (result.type === 'assemble_draft') {
      expect(result.output).toEqual({ kind: 'draft_note', requestedFormat: 'table', defaultFormat: 'bullet_list' });
      expect(result.draftMarkdown).not.toMatch(/OpenAI|Ollama|complete\(/);
    }
  });

  // @scenario S9
  it('E2_budget_exhaustion_fails_closed', async () => {
    const p = plan();
    const priorResults = Array.from({ length: AGENT_NOTE_TOOL_BUDGETS.maxToolSteps }, (_, index): AgentNoteToolResult => ({
      type: 'assemble_draft',
      status: 'ok',
      draftMarkdown: `draft ${index}`,
      output: p.output,
      sources: [],
      usedNodes: [],
      trace: {
        planKey: p.stablePlanKey,
        toolCallId: `draft-${index}`,
        toolType: 'assemble_draft',
        status: 'ok',
        resultCount: 0,
        sourceCount: 0,
        usedNodeCount: 0,
        budgetExceeded: false,
      },
    }));
    const result = await new AgentNoteToolRunner({ store: configuredStore(), embedder: embed() }).runTool({
      plan: p,
      toolCall: p.toolCalls[0]!,
      priorResults,
    });

    expect(result.status).toBe('budget_exceeded');
    expect(result.sources).toEqual([]);
  });
});
