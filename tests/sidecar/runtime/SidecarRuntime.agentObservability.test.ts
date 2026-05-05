import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { DestinationStream } from 'pino';
import type { AgentPlanInput, AgentPlanResult, RetrievalPlan } from '@src/core/domain/agentRetrievalPlan.js';
import type { AgentToolTraceSummary } from '@src/core/domain/agentRunTrace.js';
import type { ChatStreamChunk } from '@src/core/domain/types.js';
import type { IAgentPlannerPort } from '@src/core/ports/IAgentPlannerPort.js';
import * as ChatWorkflow from '@src/core/workflows/ChatWorkflow.js';
import type { ChatWorkflowOptions, ChatWorkflowResult } from '@src/core/workflows/ChatWorkflow.js';
import { ProgressAdapter } from '@src/sidecar/adapters/ProgressAdapter.js';
import { SidecarRuntime } from '@src/sidecar/runtime/SidecarRuntime.js';

class FixturePlanner implements IAgentPlannerPort {
  async planRetrieval(_input: AgentPlanInput): Promise<AgentPlanResult> {
    return {
      planVersion: 'v1',
      status: 'needs_scope',
      reason: 'test',
      missing: ['topic'],
      stablePlanKey: 'agent-plan:v1:test',
    } as const;
  }
}

function captureLogger(): { log: pino.Logger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const destination: DestinationStream = {
    write(line: string) {
      entries.push(JSON.parse(line) as Record<string, unknown>);
      return true;
    },
  };
  return { log: pino({ level: 'debug' }, destination), entries };
}

function plan(): RetrievalPlan {
  return {
    planVersion: 'v1',
    status: 'ready',
    task: 'compile prompt containing API_KEY=secret',
    topic: 'job hunt',
    entities: ['Acme'],
    filters: { pathGlobs: ['Daily/**/*.md'] },
    output: { kind: 'draft_note', defaultFormat: 'bullet_list' },
    toolCalls: [{ id: 'search_notes-1', type: 'search_notes', reason: 'find notes', query: 'job hunt' }],
    stablePlanKey: 'agent-plan:v1:observability',
  };
}

function toolSummary(overrides: Partial<AgentToolTraceSummary> = {}): AgentToolTraceSummary {
  return {
    planKey: 'agent-plan:v1:observability',
    toolCallId: 'search_notes-1',
    toolType: 'search_notes',
    status: 'ok',
    resultCount: 2,
    sourceCount: 1,
    usedNodeCount: 2,
    budgetExceeded: false,
    ...overrides,
  };
}

async function collectChat(runtime: SidecarRuntime): Promise<{
  chunks: ChatStreamChunk[];
  result: ChatWorkflowResult;
}> {
  const chunks: ChatStreamChunk[] = [];
  const gen = runtime.handleChatStream({
    messages: [{ role: 'user', content: 'summarize API_KEY=secret raw prompt' }],
  });
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

describe('SidecarRuntime agent observability (AGT-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OBSIDIAN_AI_DB_PATH;
  });

  it('B1_logs_agent_run_lifecycle', async () => {
    // @scenario S8
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const { log, entries } = captureLogger();
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_deps, _messages, options: ChatWorkflowOptions) =>
      (async function* () {
        options.onAgentTrace?.({ type: 'plan', plan: plan() });
        options.onAgentTrace?.({ type: 'tool', tool: toolSummary() });
        options.onAgentTrace?.({
          type: 'sources',
          sources: [{ notePath: 'Daily/2026-05-01.md', nodeId: 'n1' }],
        });
        options.onAgentTrace?.({ type: 'usage', stage: 'planner', usage: { source: 'unavailable' } });
        options.completion?.onUsage?.({ source: 'reported', promptTokens: 7, completionTokens: 3, totalTokens: 10 });
        yield 'draft';
        return {
          sources: [{ notePath: 'Daily/2026-05-01.md', nodeId: 'n1' }],
          groundingOutcome: 'answered',
          groundingPolicyVersion: 'v1',
        } satisfies ChatWorkflowResult;
      })(),
    );

    const runtime = new SidecarRuntime({ log, progress: new ProgressAdapter({}), planner: new FixturePlanner() });
    await collectChat(runtime);

    const agentLogs = entries.filter((entry) => typeof entry.event === 'string' && entry.event.startsWith('agent.'));
    expect(agentLogs.map((entry) => entry.event)).toEqual([
      'agent.run_started',
      'agent.plan',
      'agent.tool',
      'agent.sources',
      'agent.usage',
      'agent.usage',
      'agent.run_done',
    ]);
    const ids = new Set(agentLogs.map((entry) => entry.agentRunId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
  });

  it('B2_budget_exceeded_logs_warn', async () => {
    // @scenario S3 S8
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const { log, entries } = captureLogger();
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_deps, _messages, options: ChatWorkflowOptions) =>
      (async function* () {
        options.onAgentTrace?.({
          type: 'budget',
          budgetName: 'agent.tool.search_notes',
          configured: 12,
          observed: 13,
          planKey: 'agent-plan:v1:observability',
        });
        yield '';
        return { sources: [], groundingOutcome: 'insufficient_evidence', groundingPolicyVersion: 'v1' };
      })(),
    );

    const runtime = new SidecarRuntime({ log, progress: new ProgressAdapter({}), planner: new FixturePlanner() });
    await collectChat(runtime);

    expect(entries).toContainEqual(
      expect.objectContaining({
        level: 40,
        event: 'agent.budget_exceeded',
        budgetName: 'agent.tool.search_notes',
        configured: 12,
        observed: 13,
        agentRunId: expect.any(String),
      }),
    );
  });

  it('B3_logs_redact_content_and_secrets', async () => {
    // @scenario S8
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const { log, entries } = captureLogger();
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_deps, _messages, options: ChatWorkflowOptions) =>
      (async function* () {
        options.onAgentTrace?.({ type: 'plan', plan: plan() });
        options.onAgentTrace?.({ type: 'tool', tool: toolSummary() });
        yield 'draft';
        return { sources: [], groundingOutcome: 'answered', groundingPolicyVersion: 'v1' };
      })(),
    );

    const runtime = new SidecarRuntime({ log, progress: new ProgressAdapter({}), planner: new FixturePlanner() });
    const { chunks } = await collectChat(runtime);
    const serializedLogs = JSON.stringify(entries);

    expect(chunks).toEqual([{ type: 'delta', delta: 'draft' }]);
    expect(serializedLogs).not.toContain('API_KEY=secret');
    expect(serializedLogs).not.toContain('raw prompt');
    expect(serializedLogs).not.toContain('Sarah said salary');
  });

  it('B4_logs_provider_usage_or_unavailable', async () => {
    // @scenario S8
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const { log, entries } = captureLogger();
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_deps, _messages, options: ChatWorkflowOptions) =>
      (async function* () {
        options.onAgentTrace?.({ type: 'usage', stage: 'planner', usage: { source: 'unavailable' } });
        options.completion?.onUsage?.({ source: 'reported', promptTokens: 11, completionTokens: 2, totalTokens: 13 });
        yield '';
        return { sources: [], groundingOutcome: 'answered', groundingPolicyVersion: 'v1' };
      })(),
    );

    const runtime = new SidecarRuntime({ log, progress: new ProgressAdapter({}), planner: new FixturePlanner() });
    await collectChat(runtime);

    expect(entries).toContainEqual(
      expect.objectContaining({ event: 'agent.usage', stage: 'planner', usage: { source: 'unavailable' } }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'agent.usage',
        stage: 'completion',
        usage: { source: 'reported', promptTokens: 11, completionTokens: 2, totalTokens: 13 },
      }),
    );
  });

  it('B5_chat_wire_payload_unchanged', async () => {
    // @scenario S8
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const { log } = captureLogger();
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_deps, _messages, options: ChatWorkflowOptions) =>
      (async function* () {
        options.onAgentTrace?.({ type: 'plan', plan: plan() });
        yield 'visible';
        return {
          sources: [{ notePath: 'Daily/2026-05-01.md', nodeId: 'n1' }],
          groundingOutcome: 'answered',
          groundingPolicyVersion: 'v1',
        } satisfies ChatWorkflowResult;
      })(),
    );

    const runtime = new SidecarRuntime({ log, progress: new ProgressAdapter({}), planner: new FixturePlanner() });
    const { chunks, result } = await collectChat(runtime);

    expect(chunks).toEqual([{ type: 'delta', delta: 'visible' }]);
    expect(result).toEqual({
      sources: [{ notePath: 'Daily/2026-05-01.md', nodeId: 'n1' }],
      groundingOutcome: 'answered',
      groundingPolicyVersion: 'v1',
    });
  });
});
