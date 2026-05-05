import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentNoteToolTrace } from '@src/core/domain/agentNoteTools.js';
import {
  AGENT_RETRIEVAL_DEFAULT_FORMAT,
  AGENT_RETRIEVAL_PLAN_VERSION,
  type RetrievalPlan,
} from '@src/core/domain/agentRetrievalPlan.js';
import {
  normalizeProviderTokenUsage,
  summarizeAgentPlan,
  summarizeAgentSources,
  summarizeAgentToolTrace,
} from '@src/core/domain/agentRunTrace.js';
import type { Source } from '@src/core/domain/types.js';

function plan(): RetrievalPlan {
  return {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'ready',
    task: 'compile API_KEY=secret job hunt notes into a draft',
    topic: 'job hunt offer details with private-token',
    entities: ['Acme Recruiter'],
    filters: {
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-24', end: '2026-05-01', defaulted: true },
      tags: ['job-search'],
    },
    output: {
      kind: 'draft_note',
      requestedFormat: 'one page memo with SECRET_TOKEN',
      defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
    },
    toolCalls: [
      {
        id: 'search_notes-1',
        type: 'search_notes',
        reason: 'find raw note: Sarah said salary is 125k',
        query: 'Sarah salary API_KEY=abc123',
      },
    ],
    stablePlanKey: 'agent-plan:v1:trace-test',
  };
}

function toolTrace(overrides: Partial<AgentNoteToolTrace> = {}): AgentNoteToolTrace {
  return {
    planKey: 'agent-plan:v1:trace-test',
    toolCallId: 'search_notes-1',
    toolType: 'search_notes',
    status: 'ok',
    resultCount: 3,
    sourceCount: 2,
    usedNodeCount: 3,
    budgetExceeded: false,
    ...overrides,
  };
}

describe('agent run trace helpers (AGT-6)', () => {
  it('A1_plan_summary_redacts_sensitive_content', () => {
    // @scenario S8
    const summary = summarizeAgentPlan(plan());
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      planKey: 'agent-plan:v1:trace-test',
      status: 'ready',
      taskLabel: expect.stringMatching(/^sha256:/),
      topicLabel: expect.stringMatching(/^sha256:/),
      outputKind: 'draft_note',
      requestedFormatLabel: expect.stringMatching(/^sha256:/),
      toolCallCount: 1,
    });
    expect(summary.filters).toEqual({
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-24', end: '2026-05-01', defaulted: true },
      tags: ['job-search'],
    });
    expect(serialized).not.toContain('Sarah');
    expect(serialized).not.toContain('salary');
    expect(serialized).not.toContain('API_KEY');
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('private-token');
  });

  it('A2_tool_summary_excludes_content', () => {
    // @scenario S8
    const summary = summarizeAgentToolTrace(toolTrace({ budgetExceeded: true, status: 'budget_exceeded' }));

    expect(summary).toEqual({
      planKey: 'agent-plan:v1:trace-test',
      toolCallId: 'search_notes-1',
      toolType: 'search_notes',
      status: 'budget_exceeded',
      resultCount: 3,
      sourceCount: 2,
      usedNodeCount: 3,
      budgetExceeded: true,
    });
    expect(JSON.stringify(summary)).not.toContain('snippet');
    expect(JSON.stringify(summary)).not.toContain('content');
  });

  it('A3_source_summary_matches_used_sources', () => {
    // @scenario S8
    const sources: Source[] = [
      { notePath: 'Daily/2026-05-01.md', nodeId: 'n1' },
      { notePath: 'Projects/Agent.md', nodeId: 'n2' },
    ];

    expect(summarizeAgentSources(sources)).toEqual({
      sourceCount: 2,
      notePaths: ['Daily/2026-05-01.md', 'Projects/Agent.md'],
      hasNodeAnchors: true,
    });
  });

  it('A4_usage_reported_vs_unavailable', () => {
    // @scenario S8
    expect(normalizeProviderTokenUsage({ promptTokens: 10, completionTokens: 4 })).toEqual({
      source: 'reported',
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });
    expect(normalizeProviderTokenUsage(undefined)).toEqual({ source: 'unavailable' });
  });

  it('Y8_no_persistence_write_or_budget_setting_surface', () => {
    const root = process.cwd();
    const files = [
      'src/plugin/ui/ChatView.ts',
      'src/plugin/settings/SettingsTab.ts',
      'src/plugin/agent/AgentNoteWriter.ts',
    ];
    const combined = files.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    expect(combined).not.toContain('agentRunTrace');
    expect(combined).not.toContain('maxToolSteps');
    expect(combined).not.toContain('maxPlannerOutputTokens');
  });
});
