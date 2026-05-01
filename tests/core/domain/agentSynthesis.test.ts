import { describe, expect, it } from 'vitest';
import type { AgentNoteToolResult } from '@src/core/domain/agentNoteTools.js';
import {
  AGENT_RETRIEVAL_DEFAULT_FORMAT,
  AGENT_RETRIEVAL_PLAN_VERSION,
  type RetrievalPlan,
} from '@src/core/domain/agentRetrievalPlan.js';
import { buildAgentSynthesisContext } from '@src/core/domain/agentSynthesis.js';
import type { ChatMessage, SearchResult } from '@src/core/domain/types.js';

function plan(overrides: Partial<RetrievalPlan> = {}): RetrievalPlan {
  return {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'ready',
    task: 'compile a status note',
    topic: 'project beta',
    entities: ['beta'],
    filters: {},
    output: {
      kind: 'draft_note',
      defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
    },
    toolCalls: [{ id: 'search-1', type: 'search_notes', reason: 'find beta notes', query: 'beta' }],
    stablePlanKey: 'agent-plan:v1:synthesis',
    ...overrides,
  };
}

function result(nodeId: string, notePath: string, snippet: string, score = 0.1): SearchResult {
  return {
    nodeId,
    notePath,
    score,
    snippet,
    headingTrail: ['Status'],
  };
}

function searchResult(results: SearchResult[]): AgentNoteToolResult {
  return {
    type: 'search_notes',
    status: 'ok',
    results,
    sources: results.map((item) => ({ notePath: item.notePath, nodeId: item.nodeId })),
    usedNodes: results.map((item, index) => ({
      nodeId: item.nodeId,
      notePath: item.notePath,
      insertionOrder: index,
    })),
    trace: {
      planKey: 'agent-plan:v1:synthesis',
      toolCallId: 'search-1',
      toolType: 'search_notes',
      status: 'ok',
      resultCount: results.length,
      sourceCount: results.length,
      usedNodeCount: results.length,
      budgetExceeded: false,
    },
  };
}

function readResult(nodes: Array<{ nodeId: string; notePath: string; content: string }>): AgentNoteToolResult {
  return {
    type: 'read_note',
    status: 'ok',
    nodes: nodes.map((node) => ({ ...node, headingTrail: ['Details'] })),
    sources: nodes.map((node) => ({ notePath: node.notePath, nodeId: node.nodeId })),
    usedNodes: nodes.map((node, index) => ({ nodeId: node.nodeId, notePath: node.notePath, insertionOrder: index })),
    trace: {
      planKey: 'agent-plan:v1:synthesis',
      toolCallId: 'read-1',
      toolType: 'read_note',
      status: 'ok',
      resultCount: nodes.length,
      sourceCount: nodes.length,
      usedNodeCount: nodes.length,
      budgetExceeded: false,
    },
  };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'Use a cheerful tone.' },
  { role: 'user', content: 'Use facts from the public web about Project Beta.' },
];

describe('agentSynthesis', () => {
  // @scenario S6
  it('A1_context_uses_tool_results_only', () => {
    const context = buildAgentSynthesisContext({
      plan: plan(),
      toolResults: [searchResult([result('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.')])],
      messages,
    });

    expect(context.retrievalContext).toContain('Beta launch is blocked by design review.');
    expect(context.retrievalContext).toContain('Projects/beta.md#n1');
    expect(context.retrievalContext).not.toContain('public web');
    expect(context.retrievalContext).not.toContain('cheerful tone');
  });

  // @scenario S6
  it('A2_empty_context_reports_gap', () => {
    const context = buildAgentSynthesisContext({
      plan: plan(),
      toolResults: [searchResult([])],
      messages,
    });

    expect(context.isInsufficient).toBe(true);
    expect(context.retrievalContext).toBe('');
    expect(context.sources).toEqual([]);
    expect(context.insufficientReason).toContain('No usable vault context');
  });

  // @scenario S5
  it('A3_sources_match_included_context', () => {
    const context = buildAgentSynthesisContext(
      {
        plan: plan(),
        toolResults: [
          searchResult([
            result('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.'),
            result('n2', 'Projects/beta.md', 'Beta owner is Dana.'),
            result('n3', 'Daily/2026-04-30.md', 'Beta follow-up scheduled for Friday.'),
          ]),
        ],
        messages,
      },
      { maxIncludedItems: 2 },
    );

    expect(context.retrievalContext).toContain('Beta launch is blocked by design review.');
    expect(context.retrievalContext).toContain('Beta owner is Dana.');
    expect(context.retrievalContext).not.toContain('Beta follow-up scheduled for Friday.');
    expect(context.sources).toEqual([{ notePath: 'Projects/beta.md', nodeId: 'n1' }]);
    expect(context.usedNodes).toEqual([
      { notePath: 'Projects/beta.md', nodeId: 'n1', insertionOrder: 0 },
      { notePath: 'Projects/beta.md', nodeId: 'n2', insertionOrder: 1 },
    ]);
  });

  // @scenario S4
  it('B1_defaults_to_bullet_list', () => {
    const context = buildAgentSynthesisContext({
      plan: plan({ output: { kind: 'answer', defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT } }),
      toolResults: [searchResult([result('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.')])],
      messages,
    });

    expect(context.outputKind).toBe('answer');
    expect(context.requestedFormat).toBeUndefined();
    expect(context.retrievalContext).toContain('Default output format: bullet list');
  });

  // @scenario S4
  it('B2_requested_format_instructions', () => {
    const context = buildAgentSynthesisContext({
      plan: plan({
        output: {
          kind: 'draft_note',
          requestedFormat: 'meeting summary with decisions and action items',
          defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
        },
      }),
      toolResults: [readResult([{ nodeId: 'n4', notePath: 'Meetings/beta.md', content: 'Decision: postpone launch.' }])],
      messages,
    });

    expect(context.requestedFormat).toBe('meeting summary with decisions and action items');
    expect(context.retrievalContext).toContain('Requested output format: meeting summary with decisions and action items');
    expect(context.retrievalContext).not.toContain('Default output format: bullet list');
  });

  // @scenario S9
  it('B3_draft_output_is_chat_only', () => {
    const context = buildAgentSynthesisContext({
      plan: plan(),
      toolResults: [searchResult([result('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.')])],
      messages,
    });

    expect(context.outputKind).toBe('draft_note');
    expect(context.retrievalContext).toContain('Return draft content in chat only');
    expect(context.retrievalContext).not.toMatch(/write|save|create a vault file|review UI/i);
  });
});
