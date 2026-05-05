import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AGENT_PLANNER_BUDGETS,
  AGENT_RETRIEVAL_DEFAULT_FORMAT,
  AGENT_RETRIEVAL_PLAN_VERSION,
  AgentPlanValidationError,
  type AgentPlanInput,
  type AgentPlanResult,
  type AgentToolCallPlan,
  type NeedsScopePlan,
  type RetrievalPlan,
  createStablePlanKey,
  defaultOneWeekDateRange,
  normalizeAgentPlanResult,
  normalizeNeedsScopePlan,
  normalizeRetrievalPlan,
  type RetrievalPlanDraft,
} from '@src/core/domain/agentRetrievalPlan.js';

const baseInput: AgentPlanInput = {
  userPrompt: 'Draft a summary of my job search activity this week as a table',
  conversation: [{ role: 'user', content: 'Previous question' }],
  vaultOrganizationPrompt: 'Daily notes live under Daily/YYYY-MM-DD.md',
  explicitPathGlobs: ['Work/**/*.md'],
  dailyNotePathGlobs: ['Daily/**/*.md'],
  anchorDate: '2026-04-30',
  modelConfigId: 'ollama:llama3.1:8b',
  vaultIndexFingerprint: 'vault-fingerprint-001',
};

function readyDraft(overrides: Partial<RetrievalPlanDraft> = {}): RetrievalPlanDraft {
  return {
    task: 'Summarize job search activity',
    topic: 'job search',
    entities: ['applications', 'interviews'],
    filters: {
      pathGlobs: ['Work/**/*.md'],
      tags: ['career'],
    },
    output: {
      kind: 'answer',
      requestedFormat: 'table',
    },
    toolCalls: [
      {
        id: 'search-raw',
        type: 'search_notes',
        reason: 'Find relevant notes',
        query: 'job search applications interviews',
      },
    ],
    ...overrides,
  };
}

describe('agentRetrievalPlan contract types (AGT-2)', () => {
  it('A1_exports_plan_contract_shapes', () => {
    expectTypeOf<AgentPlanInput>().toMatchTypeOf<{
      userPrompt: string;
      conversation: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      vaultOrganizationPrompt?: string;
      explicitPathGlobs?: string[];
      explicitDateRange?: { start?: string; end?: string };
      dailyNotePathGlobs?: string[];
      anchorDate: string;
      modelConfigId: string;
      vaultIndexFingerprint: string;
    }>();
    expectTypeOf<AgentToolCallPlan>().toMatchTypeOf<{
      id: string;
      type: 'search_notes' | 'read_note' | 'assemble_draft';
      reason: string;
      query?: string;
      pathGlobs?: string[];
    }>();
    expectTypeOf<AgentPlanResult>().toEqualTypeOf<RetrievalPlan | NeedsScopePlan>();

    const plan = normalizeRetrievalPlan(baseInput, readyDraft());
    expect(plan.planVersion).toBe(AGENT_RETRIEVAL_PLAN_VERSION);
    expect(plan.output.defaultFormat).toBe(AGENT_RETRIEVAL_DEFAULT_FORMAT);
  });

  // @scenario S1
  it('A2_ready_plan_has_required_fields', () => {
    const plan = normalizeRetrievalPlan(baseInput, readyDraft());

    expect(plan).toMatchObject({
      planVersion: 'v1',
      status: 'ready',
      task: 'Summarize job search activity',
      topic: 'job search',
      entities: ['applications', 'interviews'],
      filters: {
        pathGlobs: ['Work/**/*.md'],
        tags: ['career'],
      },
      output: {
        kind: 'answer',
        requestedFormat: 'table',
        defaultFormat: 'bullet_list',
      },
    });
    expect(plan.toolCalls).toEqual([
      {
        id: 'search_notes-1',
        type: 'search_notes',
        reason: 'Find relevant notes',
        query: 'job search applications interviews',
        pathGlobs: ['Work/**/*.md'],
      },
    ]);
    expect(plan.stablePlanKey).toMatch(/^agent-plan:v1:[a-f0-9]{64}$/);
  });

  // @scenario S1
  it('A2_ready_plan_requires_search_notes', () => {
    expect(() =>
      normalizeRetrievalPlan(
        baseInput,
        readyDraft({
          toolCalls: [{ id: 'draft-only', type: 'assemble_draft', reason: 'Draft after retrieval' }],
        }),
      ),
    ).toThrow('search_notes');
  });

  // @scenario S2
  it('A3_needs_scope_plan_is_not_searchable', () => {
    const plan = normalizeNeedsScopePlan(baseInput, {
      status: 'needs_scope',
      reason: 'Please name a topic or folder to search.',
      missing: ['scope', 'topic'],
    });

    expect(plan).toEqual({
      planVersion: 'v1',
      status: 'needs_scope',
      reason: 'Please name a topic or folder to search.',
      missing: ['topic', 'scope'],
      stablePlanKey: plan.stablePlanKey,
    });
    expect(JSON.stringify(plan)).not.toContain('search_notes');
    expect(() =>
      normalizeNeedsScopePlan(baseInput, {
        reason: 'Too broad.',
        missing: ['scope'],
        toolCalls: [{ id: 'bad', type: 'search_notes', reason: 'Search everything' }],
      }),
    ).toThrow(AgentPlanValidationError);
  });

  // @scenario S7
  it('B1_normalization_stable_order', () => {
    const first = normalizeRetrievalPlan(
      baseInput,
      readyDraft({
        entities: ['Zed', 'alpha', 'Zed', 'beta'],
        filters: { pathGlobs: ['Z/**/*.md', 'A/**/*.md', 'A/**/*.md'], tags: ['b', 'a', 'b'] },
        toolCalls: [
          { id: '2', type: 'read_note', reason: 'Read detail', pathGlobs: ['B.md', 'A.md'] },
          { id: '1', type: 'search_notes', reason: 'Search topic', query: 'topic' },
        ],
      }),
    );
    const second = normalizeRetrievalPlan(
      baseInput,
      readyDraft({
        entities: ['beta', 'Zed', 'alpha'],
        filters: { tags: ['a', 'b'], pathGlobs: ['A/**/*.md', 'Z/**/*.md'] },
        toolCalls: [
          { id: 'search', type: 'search_notes', reason: 'Search topic', query: 'topic' },
          { id: 'read', type: 'read_note', reason: 'Read detail', pathGlobs: ['A.md', 'B.md'] },
        ],
      }),
    );

    expect(first.entities).toEqual(['alpha', 'beta', 'Zed']);
    expect(first.filters).toMatchObject({ pathGlobs: ['A/**/*.md', 'Z/**/*.md'], tags: ['a', 'b'] });
    expect(first).toEqual(second);
  });

  // @scenario S7
  it('B2_same_inputs_same_plan_key', () => {
    const first = normalizeAgentPlanResult(baseInput, readyDraft());
    const second = normalizeAgentPlanResult({ ...baseInput }, readyDraft());

    expect(first).toEqual(second);
    expect(first.stablePlanKey).toBe(second.stablePlanKey);
  });

  // @scenario S1
  it('B3_date_bounded_defaults_to_one_week', () => {
    const plan = normalizeRetrievalPlan(
      { ...baseInput, explicitPathGlobs: undefined, explicitDateRange: undefined },
      readyDraft({ filters: {}, dateBoundedSynthesis: true, output: { kind: 'draft_note' } }),
    );

    expect(defaultOneWeekDateRange('2026-04-30')).toEqual({
      start: '2026-04-24',
      end: '2026-04-30',
      defaulted: true,
    });
    expect(plan.filters.dateRange).toEqual({ start: '2026-04-24', end: '2026-04-30', defaulted: true });
    expect(plan.filters.pathGlobs).toEqual(['Daily/**/*.md']);
  });

  // @scenario S1
  it('B4_explicit_date_range_wins', () => {
    const plan = normalizeRetrievalPlan(
      { ...baseInput, explicitDateRange: { start: '2026-04-01', end: '2026-04-15' } },
      readyDraft({ dateBoundedSynthesis: true }),
    );

    expect(plan.filters.dateRange).toEqual({ start: '2026-04-01', end: '2026-04-15' });
  });

  // @scenario S1
  it('B4_invalid_date_ranges_are_rejected', () => {
    expect(() =>
      normalizeRetrievalPlan(
        { ...baseInput, explicitDateRange: { start: 'last week', end: '2026-04-15' } },
        readyDraft(),
      ),
    ).toThrow('YYYY-MM-DD');
    expect(() =>
      normalizeRetrievalPlan(baseInput, readyDraft({ filters: { dateRange: { start: '2026-02-31' } } })),
    ).toThrow('real YYYY-MM-DD');
  });

  // @scenario S1
  it('B5_output_format_defaults_to_bullets', () => {
    const requested = normalizeRetrievalPlan(baseInput, readyDraft({ output: { kind: 'draft_note', requestedFormat: 'outline' } }));
    const omitted = normalizeRetrievalPlan(baseInput, readyDraft({ output: { kind: 'answer' } }));

    expect(requested.output).toEqual({
      kind: 'draft_note',
      requestedFormat: 'outline',
      defaultFormat: 'bullet_list',
    });
    expect(omitted.output).toEqual({ kind: 'answer', defaultFormat: 'bullet_list' });
  });

  // @scenario S1
  it('B6_vault_org_prompt_does_not_override_grounding', () => {
    const plan = normalizeRetrievalPlan(
      baseInput,
      readyDraft({
        filters: {},
        grounding: { allowedSource: 'vault' },
      }),
    );

    expect(plan.filters.pathGlobs).toEqual(['Work/**/*.md']);
    expect(() =>
      normalizeRetrievalPlan(
        baseInput,
        readyDraft({
          grounding: { allowedSource: 'external', allowExternalSources: true },
        }),
      ),
    ).toThrow('off-vault sources');
    expect(() =>
      normalizeRetrievalPlan(
        baseInput,
        readyDraft({
          grounding: { groundingPolicyOverride: 'Use web sources when the vault is sparse.' },
        }),
      ),
    ).toThrow('built-in grounding policy');
  });

  it('Y7_no_runtime_tool_or_file_write_surface', () => {
    const source = readFileSync('src/core/domain/agentRetrievalPlan.ts', 'utf8');
    expect(source).not.toMatch(/Ollama|OpenAI|SearchWorkflow|ChatWorkflow|writeFile|appendFile|fs\./);

    const plan = normalizeRetrievalPlan(baseInput, readyDraft());
    expect(plan.toolCalls.map((toolCall) => toolCall.type)).toEqual(['search_notes']);
  });

  it('Y8_budget_constants_not_settings', () => {
    expect(AGENT_PLANNER_BUDGETS).toEqual({
      maxPlanningSteps: 6,
      maxToolCalls: 8,
      maxPlannerOutputTokens: 2048,
    });

    const source = readFileSync('src/core/domain/agentRetrievalPlan.ts', 'utf8');
    expect(source).not.toMatch(/plugin settings|settings\./i);
  });

  it('Z5_no_raw_prompt_or_note_content_required_for_plan_key', () => {
    const input: AgentPlanInput = {
      ...baseInput,
      userPrompt: 'private raw prompt about a secret project',
      conversation: [{ role: 'user', content: 'private note content' }],
      vaultOrganizationPrompt: 'private folder taxonomy',
    };
    const plan = normalizeRetrievalPlan(input, readyDraft());
    const { stablePlanKey: _stablePlanKey, ...planWithoutKey } = plan;
    const key = createStablePlanKey(input, planWithoutKey);

    expect(plan.stablePlanKey).toBe(key);
    expect(plan.stablePlanKey).not.toContain('private raw prompt');
    expect(plan.stablePlanKey).not.toContain('private note content');
    expect(plan.stablePlanKey).not.toContain('private folder taxonomy');
  });
});
