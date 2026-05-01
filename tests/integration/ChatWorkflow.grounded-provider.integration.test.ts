import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage } from '@src/core/domain/types.js';
import type { RetrievalPlan } from '@src/core/domain/agentRetrievalPlan.js';
import {
  AGENT_RETRIEVAL_DEFAULT_FORMAT,
  AGENT_RETRIEVAL_PLAN_VERSION,
} from '@src/core/domain/agentRetrievalPlan.js';
import type { AgentNoteToolResult, AgentNoteToolRunInput } from '@src/core/domain/agentNoteTools.js';
import type { IAgentNoteToolPort } from '@src/core/ports/IAgentNoteToolPort.js';
import type { IAgentPlannerPort } from '@src/core/ports/IAgentPlannerPort.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { buildGroundedMessages } from '@src/sidecar/adapters/chatProviderMessages.js';
import { chatWorkflowDeps } from './chatWorkflowDeps.js';
import { SearchTestStore } from '../core/workflows/searchTestStore.js';

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

class CaptureChat implements IChatPort {
  lastCall: { messages: ChatMessage[]; context: string } | null = null;
  async *complete(
    messages: ChatMessage[],
    context: string,
    _key?: string,
    _opts?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.lastCall = { messages, context };
    yield '';
  }
}

function readyPlan(): RetrievalPlan {
  return {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'ready',
    task: 'answer',
    topic: 'project beta',
    entities: [],
    filters: {},
    output: { kind: 'answer', defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT },
    toolCalls: [{ id: 'search-1', type: 'search_notes', reason: 'find beta', query: 'beta' }],
    stablePlanKey: 'agent-plan:v1:grounded',
  };
}

class FixturePlanner implements IAgentPlannerPort {
  async planRetrieval() {
    return readyPlan();
  }
}

class FixtureTools implements IAgentNoteToolPort {
  calls: AgentNoteToolRunInput[] = [];
  async runTool(input: AgentNoteToolRunInput): Promise<AgentNoteToolResult> {
    this.calls.push(input);
    return {
      type: 'search_notes',
      status: 'ok',
      results: [
        {
          nodeId: 'beta-node',
          notePath: 'Projects/beta.md',
          score: 0.1,
          snippet: 'Beta launch is blocked by design review.',
          headingTrail: ['Launch'],
        },
      ],
      sources: [{ notePath: 'Projects/beta.md', nodeId: 'beta-node' }],
      usedNodes: [{ nodeId: 'beta-node', notePath: 'Projects/beta.md', insertionOrder: 0 }],
      trace: {
        planKey: 'agent-plan:v1:grounded',
        toolCallId: input.toolCall.id,
        toolType: input.toolCall.type,
        status: 'ok',
        resultCount: 1,
        sourceCount: 1,
        usedNodeCount: 1,
        budgetExceeded: false,
      },
    };
  }
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<ChatWorkflowResult> {
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      return n.value;
    }
  }
}

describe('ChatWorkflow grounded provider integration (CHAT-3)', () => {
  it('Y7_workflow_passes_full_message_list_to_real_port', async () => {
    const store = new SearchTestStore();
    const e = embed();
    const searchRes = await runSearch(
      { store, embedder: e },
      { query: 'q', k: 10, coarseK: 32 },
      DEFAULT_SEARCH_ASSEMBLY,
    );
    const context = searchRes.results.map((r) => r.snippet).join('\n\n---\n\n');
    const messages: ChatMessage[] = [{ role: 'user', content: 'q' }];
    const expected = buildGroundedMessages(messages, {
      retrievalContext: context,
      vaultOrganizationPrompt: 'daily notes live under Daily/',
      systemPrompt: 'Be concise.',
    });

    const chat = new CaptureChat();
    await drainChatStream(
      runChatStream(chatWorkflowDeps(store, e, chat), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
        vaultOrganizationPrompt: 'daily notes live under Daily/',
        systemPrompt: 'Be concise.',
      }),
    );

    expect(chat.lastCall?.context).toBe('');
    expect(chat.lastCall?.messages).toEqual(expected);
  });

  // @scenario S6
  it('D1_agentic_context_preserves_grounding_order', async () => {
    const store = new SearchTestStore();
    const chat = new CaptureChat();
    const messages: ChatMessage[] = [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: 'summarize beta' },
    ];

    await drainChatStream(
      runChatStream(
        {
          ...chatWorkflowDeps(store, embed(), chat),
          planner: new FixturePlanner(),
          noteTools: new FixtureTools(),
        },
        messages,
        {
          search: DEFAULT_SEARCH_ASSEMBLY,
          vaultOrganizationPrompt: 'Project notes live under Projects/',
          systemPrompt: 'Be concise.',
        },
      ),
    );

    const sent = chat.lastCall?.messages ?? [];
    expect(sent[0]?.role).toBe('system');
    expect(sent[0]?.content).toContain('[grounding_policy_version=v1]');
    expect(sent[1]).toEqual({ role: 'system', content: 'Project notes live under Projects/' });
    expect(sent[2]).toEqual({ role: 'system', content: 'Be concise.' });
    expect(sent[3]?.role).toBe('system');
    expect(sent[3]?.content).toContain('Beta launch is blocked by design review.');
    expect(sent.slice(4)).toEqual(messages);
  });
});
