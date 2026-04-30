import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AgentNoteToolResult,
  type AgentNoteToolRunInput,
  type AgentSearchToolResult,
  buildToolTrace,
  sourcesFromUsedNodes,
  usedNodesFromSearchResults,
} from '@src/core/domain/agentNoteTools.js';
import type { RetrievalPlan } from '@src/core/domain/agentRetrievalPlan.js';
import type { IAgentNoteToolPort } from '@src/core/ports/IAgentNoteToolPort.js';

export type AgentNoteToolFactory = () => IAgentNoteToolPort;

export function runAgentNoteToolContract(name: string, createRunner: AgentNoteToolFactory): void {
  describe(name, () => {
    it('A3_port_contract_signature', () => {
      expectTypeOf<IAgentNoteToolPort>().toMatchTypeOf<{
        runTool(input: AgentNoteToolRunInput): Promise<AgentNoteToolResult>;
      }>();
      expect(typeof createRunner().runTool).toBe('function');
    });

    // @scenario S3
    it('B3_contract_search_results_stable_and_bounded', async () => {
      const first = await createRunner().runTool(searchInput());
      const second = await createRunner().runTool(searchInput());

      expect(first).toEqual(second);
      expect(first.type).toBe('search_notes');
      if (first.type === 'search_notes') {
        expect(first.results).toHaveLength(2);
        expect(first.sources).toEqual([
          { notePath: 'a.md', nodeId: 'a1' },
          { notePath: 'b.md', nodeId: 'b1' },
        ]);
      }
    });

    // @scenario S3
    it('E1_contract_trace_records_are_stable', async () => {
      const first = await createRunner().runTool(searchInput());
      const second = await createRunner().runTool(searchInput());

      expect(first.trace).toEqual(second.trace);
      expect(first.trace).toEqual({
        planKey: 'agent-plan:v1:contract',
        toolCallId: 'search_notes-1',
        toolType: 'search_notes',
        status: 'ok',
        resultCount: 2,
        sourceCount: 2,
        usedNodeCount: 2,
        budgetExceeded: false,
      });
      expect(JSON.stringify(first.trace)).not.toContain('alpha source content');
    });
  });
}

class FixtureAgentNoteToolRunner implements IAgentNoteToolPort {
  async runTool(input: AgentNoteToolRunInput): Promise<AgentSearchToolResult> {
    const results = [
      {
        nodeId: 'b1',
        notePath: 'b.md',
        score: 0.2,
        snippet: 'beta source content',
        headingTrail: [],
      },
      {
        nodeId: 'a1',
        notePath: 'a.md',
        score: 0.1,
        snippet: 'alpha source content',
        headingTrail: [],
      },
      {
        nodeId: 'a2',
        notePath: 'a.md',
        score: 0.3,
        snippet: 'alpha duplicate note content',
        headingTrail: [],
      },
    ].sort((a, b) => a.score - b.score || a.notePath.localeCompare(b.notePath));
    const bounded = results.slice(0, 2);
    const usedNodes = usedNodesFromSearchResults(bounded);
    const sources = sourcesFromUsedNodes(usedNodes);
    return {
      type: 'search_notes',
      status: 'ok',
      results: bounded,
      sources,
      usedNodes,
      trace: buildToolTrace(input.plan, input.toolCall, 'ok', {
        resultCount: bounded.length,
        sourceCount: sources.length,
        usedNodeCount: usedNodes.length,
        budgetExceeded: false,
      }),
    };
  }
}

function searchInput(): AgentNoteToolRunInput {
  const plan: RetrievalPlan = {
    planVersion: 'v1',
    status: 'ready',
    task: 'Search',
    topic: 'job search',
    entities: [],
    filters: {},
    output: { kind: 'answer', defaultFormat: 'bullet_list' },
    toolCalls: [{ id: 'search_notes-1', type: 'search_notes', reason: 'Search', query: 'job search' }],
    stablePlanKey: 'agent-plan:v1:contract',
  };
  return {
    plan,
    toolCall: plan.toolCalls[0]!,
    priorResults: [],
  };
}

runAgentNoteToolContract('IAgentNoteToolPort contract (AGT-3 fixture)', () => new FixtureAgentNoteToolRunner());
