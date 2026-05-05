import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type {
  AgentPlanInput,
  AgentPlanResult,
  RetrievalPlan,
} from '@src/core/domain/agentRetrievalPlan.js';
import {
  AGENT_RETRIEVAL_DEFAULT_FORMAT,
  AGENT_RETRIEVAL_PLAN_VERSION,
} from '@src/core/domain/agentRetrievalPlan.js';
import type { AgentNoteToolResult, AgentNoteToolRunInput } from '@src/core/domain/agentNoteTools.js';
import type { ChatMessage, SearchResult } from '@src/core/domain/types.js';
import type { IAgentNoteToolPort } from '@src/core/ports/IAgentNoteToolPort.js';
import type { IAgentPlannerPort } from '@src/core/ports/IAgentPlannerPort.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { SearchTestStore } from './searchTestStore.js';

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

function readyPlan(toolCalls: RetrievalPlan['toolCalls']): RetrievalPlan {
  return {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'ready',
    task: 'answer',
    topic: 'project beta',
    entities: ['beta'],
    filters: {
      pathGlobs: ['Projects/**/*.md'],
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
      tags: ['work'],
    },
    output: {
      kind: 'answer',
      defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
    },
    toolCalls,
    stablePlanKey: 'agent-plan:v1:test',
  };
}

function searchToolResult(toolCallId: string, status: AgentNoteToolResult['status'] = 'ok'): AgentNoteToolResult {
  const result: SearchResult = {
    nodeId: 'n1',
    notePath: 'Projects/beta.md',
    score: 0.1,
    snippet: 'Beta launch is blocked by design review.',
    headingTrail: ['Launch'],
  };
  return {
    type: 'search_notes',
    status,
    results: [result],
    sources: [{ notePath: result.notePath, nodeId: result.nodeId }],
    usedNodes: [{ nodeId: result.nodeId, notePath: result.notePath, insertionOrder: 0 }],
    trace: {
      planKey: 'agent-plan:v1:test',
      toolCallId,
      toolType: 'search_notes',
      status,
      resultCount: 1,
      sourceCount: 1,
      usedNodeCount: 1,
      budgetExceeded: status === 'budget_exceeded',
    },
  };
}

class FixturePlanner implements IAgentPlannerPort {
  inputs: AgentPlanInput[] = [];
  constructor(private readonly result: AgentPlanResult) {}
  async planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult> {
    this.inputs.push(input);
    return this.result;
  }
}

class RecordingTools implements IAgentNoteToolPort {
  calls: AgentNoteToolRunInput[] = [];
  constructor(private readonly results: AgentNoteToolResult[]) {}
  async runTool(input: AgentNoteToolRunInput): Promise<AgentNoteToolResult> {
    this.calls.push(input);
    return this.results[this.calls.length - 1] ?? searchToolResult(input.toolCall.id);
  }
}

class RecordingChat implements IChatPort {
  calls: Array<{ messages: ChatMessage[]; context: string; options?: ChatCompletionOptions }> = [];
  async *complete(
    messages: ChatMessage[],
    context: string,
    _key?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.calls.push({ messages, context, options });
    yield 'grounded answer';
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<{ deltas: string[]; result: ChatWorkflowResult }> {
  const deltas: string[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { deltas, result: n.value };
    deltas.push(n.value);
  }
}

function agenticDeps(planner: IAgentPlannerPort, noteTools: IAgentNoteToolPort, chat: IChatPort) {
  return {
    store: new SearchTestStore(),
    embedder: embed(),
    chat,
    planner,
    noteTools,
    buildGroundedMessages: (messages: ChatMessage[], grounding: { retrievalContext: string }) => [
      { role: 'system' as const, content: grounding.retrievalContext },
      ...messages,
    ],
  };
}

describe('ChatWorkflow agentic loop (AGT-4)', () => {
  it('A1_accepts_planner_and_tool_ports', async () => {
    const planner = new FixturePlanner(
      readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]),
    );
    const tools = new RecordingTools([searchToolResult('search-1')]);
    const chat = new RecordingChat();

    const result = await drainChatStream(
      runChatStream(agenticDeps(planner, tools, chat), [{ role: 'user', content: 'summarize beta' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );

    expect(planner.inputs).toHaveLength(1);
    expect(tools.calls).toHaveLength(1);
    expect(chat.calls).toHaveLength(1);
    expect(result.result.groundingOutcome).toBe('answered');
  });

  // @scenario S1
  it('B1_plans_before_tools_or_search', async () => {
    const events: string[] = [];
    const planner: IAgentPlannerPort = {
      async planRetrieval(input) {
        events.push(`plan:${input.userPrompt}`);
        return readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]);
      },
    };
    const tools: IAgentNoteToolPort = {
      async runTool(input) {
        events.push(`tool:${input.toolCall.id}`);
        return searchToolResult(input.toolCall.id);
      },
    };

    await drainChatStream(
      runChatStream(agenticDeps(planner, tools, new RecordingChat()), [{ role: 'user', content: 'beta' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );

    expect(events).toEqual(['plan:beta', 'tool:search-1']);
  });

  // @scenario S1
  // @scenario S7
  it('B2_planner_input_contains_settings_and_fingerprint', async () => {
    const planner = new FixturePlanner(
      readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]),
    );
    const messages: ChatMessage[] = [
      { role: 'user', content: 'previous' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'beta status' },
    ];

    await drainChatStream(
      runChatStream(agenticDeps(planner, new RecordingTools([searchToolResult('search-1')]), new RecordingChat()), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
        pathGlobs: ['Projects/**/*.md'],
        dateRange: { start: '2026-04-01', end: '2026-04-30' },
        dailyNotePathGlobs: ['Daily/**/*.md'],
        vaultOrganizationPrompt: 'Projects live under Projects/',
        modelConfigId: 'ollama:llama3',
        vaultIndexFingerprint: 'vault-index:abc',
        resolverClock: { now: () => new Date('2026-04-30T12:00:00.000Z'), timeZone: () => 'UTC' },
      }),
    );

    expect(planner.inputs[0]).toMatchObject({
      userPrompt: 'beta status',
      conversation: messages,
      vaultOrganizationPrompt: 'Projects live under Projects/',
      explicitPathGlobs: ['Projects/**/*.md'],
      explicitDateRange: { start: '2026-04-01', end: '2026-04-30' },
      dailyNotePathGlobs: ['Daily/**/*.md'],
      anchorDate: '2026-04-30',
      modelConfigId: 'ollama:llama3',
      vaultIndexFingerprint: 'vault-index:abc',
    });
  });

  // @scenario S2
  it('B3_needs_scope_skips_tools_and_provider', async () => {
    const planner = new FixturePlanner({
      planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
      status: 'needs_scope',
      reason: 'missing topic',
      missing: ['topic'],
      stablePlanKey: 'agent-plan:v1:needs-scope',
    });
    const tools = new RecordingTools([]);
    const chat = new RecordingChat();

    const out = await drainChatStream(
      runChatStream(agenticDeps(planner, tools, chat), [{ role: 'user', content: 'summarize it' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );

    expect(tools.calls).toHaveLength(0);
    expect(chat.calls).toHaveLength(0);
    expect(out.deltas.join('')).toContain('missing topic');
    expect(out.result).toEqual({
      sources: [],
      groundingOutcome: 'insufficient_evidence',
      groundingPolicyVersion: 'v1',
    });
  });

  // @scenario S3
  it('C1_executes_planned_tools_in_order', async () => {
    const planner = new FixturePlanner(
      readyPlan([
        { id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' },
        { id: 'read-1', type: 'read_note', reason: 'read hits' },
        { id: 'draft-1', type: 'assemble_draft', reason: 'draft' },
      ]),
    );
    const tools = new RecordingTools([searchToolResult('search-1'), searchToolResult('read-1'), searchToolResult('draft-1')]);

    await drainChatStream(
      runChatStream(agenticDeps(planner, tools, new RecordingChat()), [{ role: 'user', content: 'beta' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );

    expect(tools.calls.map((call) => call.toolCall.id)).toEqual(['search-1', 'read-1', 'draft-1']);
  });

  // @scenario S3
  // @scenario S9
  it('C2_tool_budget_stop_is_terminal', async () => {
    const planner = new FixturePlanner(
      readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]),
    );
    const tools = new RecordingTools([searchToolResult('search-1', 'budget_exceeded')]);
    const chat = new RecordingChat();

    const out = await drainChatStream(
      runChatStream(agenticDeps(planner, tools, chat), [{ role: 'user', content: 'beta' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );

    expect(chat.calls).toHaveLength(0);
    expect(out.result.groundingOutcome).toBe('insufficient_evidence');
  });

  // @scenario S3
  it('C3_forwards_plan_scope_to_tools', async () => {
    const planner = new FixturePlanner(
      readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]),
    );
    const tools = new RecordingTools([searchToolResult('search-1')]);

    await drainChatStream(
      runChatStream(agenticDeps(planner, tools, new RecordingChat()), [{ role: 'user', content: 'beta' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
        apiKey: 'key',
        k: 7,
        coarseK: 32,
        enableHybridSearch: true,
      }),
    );

    expect(tools.calls[0]).toMatchObject({
      apiKey: 'key',
      k: 7,
      coarseK: 32,
      enableHybridSearch: true,
      plan: {
        filters: {
          pathGlobs: ['Projects/**/*.md'],
          dateRange: { start: '2026-04-01', end: '2026-04-30' },
          tags: ['work'],
        },
      },
    });
  });

  // @scenario S6
  it('D2_sources_match_tool_context', async () => {
    const planner = new FixturePlanner(
      readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]),
    );
    const chat = new RecordingChat();

    const out = await drainChatStream(
      runChatStream(
        agenticDeps(planner, new RecordingTools([searchToolResult('search-1')]), chat),
        [{ role: 'user', content: 'beta' }],
        { search: DEFAULT_SEARCH_ASSEMBLY },
      ),
    );

    expect(chat.calls[0]?.messages.some((message) => message.content.includes('Beta launch is blocked'))).toBe(true);
    expect(out.result.sources).toEqual([{ notePath: 'Projects/beta.md', nodeId: 'n1' }]);
  });

  // @scenario S7
  it('D3_repeated_runs_stable_source_set', async () => {
    const plan = readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]);
    const run = async () =>
      drainChatStream(
        runChatStream(
          agenticDeps(new FixturePlanner(plan), new RecordingTools([searchToolResult('search-1')]), new RecordingChat()),
          [{ role: 'user', content: 'beta' }],
          { search: DEFAULT_SEARCH_ASSEMBLY, modelConfigId: 'test-model', vaultIndexFingerprint: 'test-index' },
        ),
      );

    const a = await run();
    const b = await run();

    expect(a.result.sources).toEqual(b.result.sources);
    expect(a.deltas).toEqual(b.deltas);
  });

  it('D4_abort_and_timeout_still_stop_stream', async () => {
    const planner = new FixturePlanner(
      readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }]),
    );
    const timeoutChat: IChatPort = {
      async *complete() {
        await new Promise<void>(() => {});
        yield 'never';
      },
    };

    const timeoutOut = await drainChatStream(
      runChatStream(
        agenticDeps(planner, new RecordingTools([searchToolResult('search-1')]), timeoutChat),
        [{ role: 'user', content: 'beta' }],
        { search: DEFAULT_SEARCH_ASSEMBLY, completion: { timeoutMs: 50 } },
      ),
    );

    expect(timeoutOut.deltas).toEqual([]);
    expect(timeoutOut.result.sources).toEqual([{ notePath: 'Projects/beta.md', nodeId: 'n1' }]);

    const ac = new AbortController();
    const abortChat: IChatPort = {
      async *complete() {
        yield 'first';
        await new Promise<void>(() => {});
      },
    };
    const abortStream = runChatStream(
      agenticDeps(
        new FixturePlanner(readyPlan([{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }])),
        new RecordingTools([searchToolResult('search-1')]),
        abortChat,
      ),
      [{ role: 'user', content: 'beta' }],
      { search: DEFAULT_SEARCH_ASSEMBLY, completion: { signal: ac.signal } },
    );
    const first = await abortStream.next();
    expect(first.done).toBe(false);
    ac.abort();
    const aborted = await abortStream.next();
    expect(aborted.done).toBe(true);
    if (aborted.done) {
      expect(aborted.value.sources).toEqual([{ notePath: 'Projects/beta.md', nodeId: 'n1' }]);
    }
  });

  // @scenario S9
  it('Y8_no_vault_write_surface', () => {
    const source = readFileSync('src/core/workflows/ChatWorkflow.ts', 'utf8');
    expect(source).not.toMatch(/AgentNoteWriter|IVaultAccessPort|Vault\.create|Vault\.modify|fs\.writeFile/);
  });
});
