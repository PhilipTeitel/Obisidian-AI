import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { AgentNoteToolResult, AgentNoteToolRunInput } from '@src/core/domain/agentNoteTools.js';
import {
  AGENT_RETRIEVAL_DEFAULT_FORMAT,
  AGENT_RETRIEVAL_PLAN_VERSION,
  type AgentPlanResult,
  type RetrievalPlan,
} from '@src/core/domain/agentRetrievalPlan.js';
import { buildAgentSynthesisContext } from '@src/core/domain/agentSynthesis.js';
import type { BuildGroundedMessagesHooks, ChatMessage, GroundingContext, SearchResult } from '@src/core/domain/types.js';
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

function readyPlan(output: RetrievalPlan['output']): RetrievalPlan {
  return {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'ready',
    task: 'compile a beta status note',
    topic: 'project beta',
    entities: ['beta'],
    filters: {},
    output,
    toolCalls: [{ id: 'search-1', type: 'search_notes', reason: 'find beta notes', query: 'beta' }],
    stablePlanKey: 'agent-plan:v1:synthesis-workflow',
  };
}

function searchResult(nodeId: string, notePath: string, snippet: string): SearchResult {
  return {
    nodeId,
    notePath,
    score: 0.1,
    snippet,
    headingTrail: ['Status'],
  };
}

function searchToolResult(results: SearchResult[]): AgentNoteToolResult {
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
      planKey: 'agent-plan:v1:synthesis-workflow',
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

class FixturePlanner implements IAgentPlannerPort {
  constructor(private readonly result: AgentPlanResult) {}
  async planRetrieval(): Promise<AgentPlanResult> {
    return this.result;
  }
}

class FixtureTools implements IAgentNoteToolPort {
  calls: AgentNoteToolRunInput[] = [];
  constructor(private readonly results: AgentNoteToolResult[]) {}
  async runTool(input: AgentNoteToolRunInput): Promise<AgentNoteToolResult> {
    this.calls.push(input);
    return this.results[this.calls.length - 1] ?? searchToolResult([]);
  }
}

class RecordingChat implements IChatPort {
  calls: Array<{ messages: ChatMessage[]; context: string; options?: ChatCompletionOptions }> = [];
  constructor(private readonly chunks: string[] = ['- Beta launch is blocked by design review.']) {}
  async *complete(
    messages: ChatMessage[],
    context: string,
    _key?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.calls.push({ messages, context, options });
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<{ deltas: string[]; result: ChatWorkflowResult }> {
  const deltas: string[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      return { deltas, result: n.value };
    }
    deltas.push(n.value);
  }
}

function deps(
  planner: IAgentPlannerPort,
  noteTools: IAgentNoteToolPort,
  chat: IChatPort,
): {
  store: SearchTestStore;
  embedder: IEmbeddingPort;
  chat: IChatPort;
  planner: IAgentPlannerPort;
  noteTools: IAgentNoteToolPort;
  buildGroundedMessages: (
    messages: ChatMessage[],
    grounding: GroundingContext,
    hooks?: BuildGroundedMessagesHooks,
  ) => ChatMessage[];
} {
  return {
    store: new SearchTestStore(),
    embedder: embed(),
    chat,
    planner,
    noteTools,
    buildGroundedMessages: (messages, grounding) => [
      { role: 'system', content: 'built-in grounding policy' },
      ...(grounding.vaultOrganizationPrompt !== undefined
        ? [{ role: 'system' as const, content: grounding.vaultOrganizationPrompt }]
        : []),
      ...(grounding.systemPrompt !== undefined ? [{ role: 'system' as const, content: grounding.systemPrompt }] : []),
      { role: 'system', content: `Vault context:\n${grounding.retrievalContext}` },
      ...messages,
    ],
  };
}

describe('ChatWorkflow synthesis (AGT-5)', () => {
  // @scenario S6
  it('C1_provider_messages_include_synthesis_context', async () => {
    const plan = readyPlan({
      kind: 'draft_note',
      requestedFormat: 'table with columns Topic and Status',
      defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
    });
    const toolResults = [
      searchToolResult([searchResult('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.')]),
    ];
    const messages: ChatMessage[] = [{ role: 'user', content: 'draft beta status as a table' }];
    const chat = new RecordingChat();

    await drainChatStream(
      runChatStream(deps(new FixturePlanner(plan), new FixtureTools(toolResults), chat), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
        vaultOrganizationPrompt: 'Project notes live under Projects/.',
        systemPrompt: 'Be concise.',
      }),
    );

    const expectedSynthesis = buildAgentSynthesisContext({ plan, toolResults, messages });
    expect(chat.calls[0]?.context).toBe('');
    expect(chat.calls[0]?.messages).toEqual([
      { role: 'system', content: 'built-in grounding policy' },
      { role: 'system', content: 'Project notes live under Projects/.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'system', content: `Vault context:\n${expectedSynthesis.retrievalContext}` },
      ...messages,
    ]);
  });

  // @scenario S5
  // @scenario S6
  it('C2_done_sources_equal_synthesis_sources', async () => {
    const plan = readyPlan({ kind: 'answer', defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT });
    const toolResults = [
      searchToolResult([
        searchResult('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.'),
        searchResult('n2', 'Projects/beta.md', 'Beta owner is Dana.'),
        searchResult('n3', 'Daily/2026-04-30.md', 'Beta follow-up scheduled for Friday.'),
      ]),
    ];
    const messages: ChatMessage[] = [{ role: 'user', content: 'summarize beta' }];

    const out = await drainChatStream(
      runChatStream(deps(new FixturePlanner(plan), new FixtureTools(toolResults), new RecordingChat()), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );

    const expectedSynthesis = buildAgentSynthesisContext({ plan, toolResults, messages });
    expect(out.result.sources).toEqual(expectedSynthesis.sources);
    expect(out.result.sources).toEqual([
      { notePath: 'Projects/beta.md', nodeId: 'n1' },
      { notePath: 'Daily/2026-04-30.md', nodeId: 'n3' },
    ]);
  });

  // @scenario S7
  it('C3_draft_structure_repeatable', async () => {
    const plan = readyPlan({
      kind: 'draft_note',
      requestedFormat: 'outline',
      defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
    });
    const toolResults = [
      searchToolResult([searchResult('n1', 'Projects/beta.md', 'Beta launch is blocked by design review.')]),
    ];
    const run = () =>
      drainChatStream(
        runChatStream(
          deps(new FixturePlanner(plan), new FixtureTools(toolResults), new RecordingChat(['## Draft\n- Beta blocked'])),
          [{ role: 'user', content: 'draft beta outline' }],
          { search: DEFAULT_SEARCH_ASSEMBLY, modelConfigId: 'test-model', vaultIndexFingerprint: 'test-index' },
        ),
      );

    const first = await run();
    const second = await run();

    expect(first.deltas).toEqual(second.deltas);
    expect(first.result.sources).toEqual(second.result.sources);
  });
});
