import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLANNER_BUDGETS,
  type AgentPlanInput,
  type AgentPlanResultDraft,
} from '@src/core/domain/agentRetrievalPlan.js';
import { OllamaAgentPlannerAdapter } from '@src/sidecar/adapters/OllamaAgentPlannerAdapter.js';
import { runAgentPlannerContract } from '../../contract/agent-planner.contract.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseInput: AgentPlanInput = {
  userPrompt: 'Draft a bullet list of my job search activity this week',
  conversation: [
    { role: 'user', content: 'raw note content should not be sent' },
    { role: 'assistant', content: 'api key sk-should-not-be-sent' },
  ],
  vaultOrganizationPrompt: 'Daily notes live under Daily/YYYY-MM-DD.md',
  explicitPathGlobs: ['Daily/**/*.md'],
  dailyNotePathGlobs: ['Daily/**/*.md'],
  anchorDate: '2026-05-01',
  modelConfigId: 'ollama:llama3.1',
  vaultIndexFingerprint: 'sqlite:test:fingerprint',
};

function readyDraft(): AgentPlanResultDraft {
  return {
    task: 'Compile a job search activity report',
    topic: 'job search',
    entities: ['Acme', 'workforce commission'],
    filters: {
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-25', end: '2026-05-01' },
      tags: ['career'],
    },
    output: {
      kind: 'draft_note',
      requestedFormat: 'bullet list',
    },
    toolCalls: [
      {
        id: 'search',
        type: 'search_notes',
        reason: 'Find vault notes about job search activity',
        query: 'job search applications interviews workforce commission',
      },
      {
        id: 'draft',
        type: 'assemble_draft',
        reason: 'Prepare draft-only output from retrieved notes',
      },
    ],
    grounding: { allowedSource: 'vault' },
  };
}

function needsScopeDraft(): AgentPlanResultDraft {
  return {
    status: 'needs_scope',
    reason: 'Please provide a topic, folder, tag, or date scope before I search the vault.',
    missing: ['topic', 'scope'],
    toolCalls: [],
    grounding: { allowedSource: 'vault' },
  };
}

function plannerResponse(draft: AgentPlanResultDraft | string): Response {
  return jsonResponse({
    message: {
      role: 'assistant',
      content: typeof draft === 'string' ? draft : JSON.stringify(draft),
    },
    prompt_eval_count: 12,
    eval_count: 8,
    done: true,
  });
}

function adapter(): OllamaAgentPlannerAdapter {
  return new OllamaAgentPlannerAdapter({
    baseUrl: ' http://127.0.0.1:11434/ ',
    model: ' llama3.1 ',
  });
}

describe('OllamaAgentPlannerAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('A1_implements_planner_port', async () => {
    const fetchMock = vi.fn().mockResolvedValue(plannerResponse(readyDraft()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const planner = adapter();

    expect(typeof planner.planRetrieval).toBe('function');
    await expect(planner.planRetrieval(baseInput)).resolves.toMatchObject({ status: 'ready' });
  });

  it('B1_posts_ollama_chat_json_request', async () => {
    // @scenario S1
    const fetchMock = vi.fn().mockResolvedValue(plannerResponse(readyDraft()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await adapter().planRetrieval(baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      format?: string;
      options?: { num_predict?: number };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.options?.num_predict).toBe(AGENT_PLANNER_BUDGETS.maxPlannerOutputTokens);
    expect(body.messages.map((message) => message.role)).toEqual(['system', 'user']);

    const serializedRequest = JSON.stringify(body);
    expect(serializedRequest).toContain(baseInput.userPrompt);
    expect(serializedRequest).toContain(baseInput.vaultIndexFingerprint);
    expect(serializedRequest).toContain(baseInput.vaultOrganizationPrompt);
    expect(serializedRequest).not.toContain('raw note content should not be sent');
    expect(serializedRequest).not.toContain('sk-should-not-be-sent');
  });

  it('B2_ready_response_normalizes_plan', async () => {
    // @scenario S1
    const fetchMock = vi.fn().mockResolvedValue(plannerResponse(readyDraft()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await adapter().planRetrieval(baseInput);

    expect(result).toMatchObject({
      status: 'ready',
      task: 'Compile a job search activity report',
      topic: 'job search',
      entities: ['Acme', 'workforce commission'],
      filters: {
        pathGlobs: ['Daily/**/*.md'],
        dateRange: { start: '2026-04-25', end: '2026-05-01' },
        tags: ['career'],
      },
      output: {
        kind: 'draft_note',
        requestedFormat: 'bullet list',
        defaultFormat: 'bullet_list',
      },
      usage: { source: 'reported', promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    });
    if (result.status === 'ready') {
      expect(result.toolCalls.map((toolCall) => toolCall.type).sort()).toEqual(['assemble_draft', 'search_notes']);
      expect(result.stablePlanKey).toMatch(/^agent-plan:v1:/);
    }
  });

  it('B3_needs_scope_response_has_no_tools', async () => {
    // @scenario S2
    const fetchMock = vi.fn().mockResolvedValue(plannerResponse(needsScopeDraft()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await adapter().planRetrieval(baseInput);

    expect(result).toMatchObject({
      status: 'needs_scope',
      reason: 'Please provide a topic, folder, tag, or date scope before I search the vault.',
      missing: ['topic', 'scope'],
    });
    expect(JSON.stringify(result)).not.toContain('search_notes');
    expect(JSON.stringify(result)).not.toContain('read_note');
  });

  it('B4_invalid_or_unsafe_response_fails_closed', async () => {
    // @scenario S2
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(plannerResponse('not json'))
      .mockResolvedValueOnce(plannerResponse({ ...readyDraft(), grounding: { allowExternalSources: true } }))
      .mockResolvedValueOnce(
        plannerResponse({
          ...needsScopeDraft(),
          toolCalls: [{ id: 'search', type: 'search_notes', reason: 'unsafe broad search' }],
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(adapter().planRetrieval(baseInput)).resolves.toMatchObject({
      status: 'needs_scope',
      missing: ['scope'],
    });
    await expect(adapter().planRetrieval(baseInput)).resolves.toMatchObject({
      status: 'needs_scope',
      missing: ['scope'],
    });
    await expect(adapter().planRetrieval(baseInput)).resolves.toMatchObject({
      status: 'needs_scope',
      missing: ['scope'],
    });
  });

  it('C2_same_fixture_response_same_plan_key', async () => {
    // @scenario S7
    const fetchMock = vi.fn().mockImplementation(async () => plannerResponse(readyDraft()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await adapter().planRetrieval(baseInput);
    const second = await adapter().planRetrieval(baseInput);

    expect(first).toEqual(second);
  });

  it('C3_uses_fixed_planner_budgets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(plannerResponse(readyDraft()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await adapter().planRetrieval(baseInput);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { options?: { num_predict?: number } };
    expect(body.options?.num_predict).toBe(AGENT_PLANNER_BUDGETS.maxPlannerOutputTokens);
  });

  it('Y8_no_tool_or_write_surface', () => {
    const source = readFileSync('src/sidecar/adapters/OllamaAgentPlannerAdapter.ts', 'utf8');

    expect(source).not.toMatch(/AgentNoteToolRunner|IAgentNoteToolPort|IDocumentStore|SearchWorkflow|writeFile|createWriteStream/);
    expect(source).toContain('/api/chat');
  });
});

describe('C1_passes_agent_planner_contract', () => {
  beforeEach(() => {
    // @scenario S7
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> };
      const content = body.messages.map((message) => message.content).join('\n');
      return plannerResponse(content.includes('Help me with this') ? needsScopeDraft() : readyDraft());
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  runAgentPlannerContract('OllamaAgentPlannerAdapter', () => adapter());
});
