import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AgentPlanInput,
  type AgentPlanResult,
  normalizeNeedsScopePlan,
  normalizeRetrievalPlan,
} from '@src/core/domain/agentRetrievalPlan.js';
import type { IAgentPlannerPort } from '@src/core/ports/IAgentPlannerPort.js';

export type AgentPlannerFactory = () => IAgentPlannerPort;

export function runAgentPlannerContract(name: string, createPlanner: AgentPlannerFactory): void {
  describe(name, () => {
    it('C1_port_contract_signature', () => {
      expectTypeOf<IAgentPlannerPort>().toMatchTypeOf<{
        planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult>;
      }>();

      const planner = createPlanner();
      expect(typeof planner.planRetrieval).toBe('function');
    });

    // @scenario S7
    it('C2_contract_ready_plan_deterministic', async () => {
      const planner = createPlanner();
      const first = await planner.planRetrieval(readyInput());
      const second = await planner.planRetrieval(readyInput());

      expect(first.status).toBe('ready');
      expect(first).toEqual(second);
    });

    // @scenario S2
    it('C3_contract_needs_scope_no_search', async () => {
      const planner = createPlanner();
      const plan = await planner.planRetrieval({
        ...readyInput(),
        userPrompt: 'Help me with this',
      });

      expect(plan.status).toBe('needs_scope');
      expect(JSON.stringify(plan)).not.toContain('search_notes');
      expect(JSON.stringify(plan)).not.toContain('read_note');
    });

    // @scenario S1
    it('C4_contract_ready_plan_search_only_tools', async () => {
      const planner = createPlanner();
      const plan = await planner.planRetrieval(readyInput());

      expect(plan.status).toBe('ready');
      if (plan.status === 'ready') {
        expect(plan.toolCalls.some((toolCall) => toolCall.type === 'search_notes')).toBe(true);
        expect(plan.toolCalls.map((toolCall) => toolCall.type).sort()).toEqual(['assemble_draft', 'search_notes']);
        expect(JSON.stringify(plan.toolCalls)).not.toMatch(/write|create_file|modify_note/);
      }
    });
  });
}

class DeterministicFixturePlanner implements IAgentPlannerPort {
  async planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult> {
    if (/^help me with this$/i.test(input.userPrompt.trim())) {
      return normalizeNeedsScopePlan(input, {
        reason: 'Please provide a topic, folder, tag, or date scope before I search the vault.',
        missing: ['topic', 'scope'],
      });
    }

    return normalizeRetrievalPlan(input, {
      task: 'Synthesize requested vault notes',
      topic: 'job search',
      entities: ['interviews', 'applications'],
      filters: {
        pathGlobs: input.explicitPathGlobs,
        dateRange: input.explicitDateRange,
        tags: ['career'],
      },
      output: {
        kind: 'draft_note',
        requestedFormat: 'bullet list',
      },
      toolCalls: [
        {
          id: 'draft',
          type: 'assemble_draft',
          reason: 'Prepare a draft-only response from retrieved notes',
        },
        {
          id: 'search',
          type: 'search_notes',
          reason: 'Find vault notes matching the topic and scope',
          query: 'job search interviews applications',
        },
      ],
      dateBoundedSynthesis: input.explicitDateRange === undefined,
    });
  }
}

function readyInput(): AgentPlanInput {
  return {
    userPrompt: 'Draft a bullet list of my job search activity this week',
    conversation: [],
    vaultOrganizationPrompt: 'Daily notes live in Daily/YYYY-MM-DD.md',
    explicitPathGlobs: ['Daily/**/*.md'],
    dailyNotePathGlobs: ['Daily/**/*.md'],
    anchorDate: '2026-04-30',
    modelConfigId: 'fixture-model',
    vaultIndexFingerprint: 'fixture-vault-index',
  };
}

runAgentPlannerContract('IAgentPlannerPort contract (AGT-2 fixture)', () => new DeterministicFixturePlanner());
