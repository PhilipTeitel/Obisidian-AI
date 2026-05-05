import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AGENT_NOTE_TOOL_BUDGETS,
  type AgentDraftToolResult,
  type AgentNoteToolResult,
  type AgentNoteToolRunInput,
  type AgentNoteToolTrace,
  buildToolTrace,
  isWriteLikeToolName,
  sourcesFromUsedNodes,
  unsupportedToolResult,
} from '@src/core/domain/agentNoteTools.js';
import type { RetrievalPlan } from '@src/core/domain/agentRetrievalPlan.js';

const plan: RetrievalPlan = {
  planVersion: 'v1',
  status: 'ready',
  task: 'Summarize',
  topic: 'job search',
  entities: ['applications'],
  filters: { pathGlobs: ['Daily/**/*.md'], tags: ['career'] },
  output: { kind: 'draft_note', defaultFormat: 'bullet_list' },
  toolCalls: [{ id: 'search_notes-1', type: 'search_notes', reason: 'Search', query: 'job search' }],
  stablePlanKey: 'agent-plan:v1:test',
};

describe('agentNoteTools domain (AGT-3)', () => {
  it('A1_exports_tool_contract_shapes', () => {
    expectTypeOf<AgentNoteToolRunInput>().toMatchTypeOf<{
      plan: RetrievalPlan;
      priorResults: AgentNoteToolResult[];
    }>();
    expectTypeOf<AgentNoteToolTrace>().toMatchTypeOf<{
      planKey: string;
      toolCallId: string;
      status: 'ok' | 'skipped' | 'needs_target' | 'budget_exceeded' | 'unsupported_tool';
    }>();
    expectTypeOf<AgentNoteToolResult>().toMatchTypeOf<AgentDraftToolResult | AgentNoteToolResult>();

    const sources = sourcesFromUsedNodes([
      { nodeId: 'n2', notePath: 'b.md', insertionOrder: 1 },
      { nodeId: 'n1', notePath: 'a.md', insertionOrder: 0 },
      { nodeId: 'n3', notePath: 'a.md', insertionOrder: 2 },
    ]);
    expect(sources).toEqual([
      { notePath: 'a.md', nodeId: 'n1' },
      { notePath: 'b.md', nodeId: 'n2' },
    ]);
  });

  it('A2_budget_constants_not_settings', () => {
    expect(AGENT_NOTE_TOOL_BUDGETS).toEqual({
      maxToolSteps: 8,
      maxSearchResults: 12,
      maxReadNodes: 40,
      maxDraftSourceTokens: 6000,
    });
    const source = readFileSync('src/core/domain/agentNoteTools.ts', 'utf8');
    expect(source).not.toMatch(/settings\.|plugin settings/i);
  });

  // @scenario S9
  it('A4_rejects_unsupported_write_like_tools', () => {
    expect(isWriteLikeToolName('write_note')).toBe(true);
    expect(isWriteLikeToolName('create_file')).toBe(true);
    expect(isWriteLikeToolName('modify_note')).toBe(true);
    expect(isWriteLikeToolName('search_notes')).toBe(false);

    const result = unsupportedToolResult(plan, {
      id: 'write-1',
      type: 'write_note' as 'search_notes',
      reason: 'Write to vault',
    });
    expect(result.status).toBe('unsupported_tool');
    expect(result.sources).toEqual([]);
    expect(result.trace).toMatchObject({ status: 'unsupported_tool', budgetExceeded: false });
  });

  // @scenario S9
  it('D2_assemble_draft_has_no_write_surface', () => {
    const domainSource = readFileSync('src/core/domain/agentNoteTools.ts', 'utf8');
    const runnerSource = readFileSync('src/core/workflows/AgentNoteToolRunner.ts', 'utf8');
    expect(`${domainSource}\n${runnerSource}`).not.toMatch(
      /AgentNoteWriter|IVaultAccessPort|Vault\.create|Vault\.modify|writeFile|appendFile|fs\./,
    );
  });

  it('buildToolTrace_excludes_raw_note_content', () => {
    const trace = buildToolTrace(plan, plan.toolCalls[0]!, 'ok', {
      resultCount: 1,
      sourceCount: 1,
      usedNodeCount: 1,
      budgetExceeded: false,
    });
    expect(JSON.stringify(trace)).not.toContain('raw note');
    expect(trace).toEqual({
      planKey: 'agent-plan:v1:test',
      toolCallId: 'search_notes-1',
      toolType: 'search_notes',
      status: 'ok',
      resultCount: 1,
      sourceCount: 1,
      usedNodeCount: 1,
      budgetExceeded: false,
    });
  });
});
