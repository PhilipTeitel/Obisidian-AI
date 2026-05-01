import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { AgentPlanInput, AgentPlanResult } from '@src/core/domain/agentRetrievalPlan.js';
import type { ChatStreamChunk } from '@src/core/domain/types.js';
import type { IAgentPlannerPort } from '@src/core/ports/IAgentPlannerPort.js';
import * as ChatWorkflow from '@src/core/workflows/ChatWorkflow.js';
import type { ChatWorkflowResult } from '@src/core/workflows/ChatWorkflow.js';
import { AgentNoteToolRunner } from '@src/core/workflows/AgentNoteToolRunner.js';
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

describe('SidecarRuntime agentic wiring (AGT-4)', () => {
  const log = pino({ level: 'silent' });
  const progress = new ProgressAdapter({});

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OBSIDIAN_AI_DB_PATH;
    delete process.env.OBSIDIAN_AI_CHAT_PROVIDER;
    delete process.env.OBSIDIAN_AI_CHAT_MODEL;
  });

  it('A2_runtime_wires_agentic_deps', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    process.env.OBSIDIAN_AI_CHAT_PROVIDER = 'ollama';
    process.env.OBSIDIAN_AI_CHAT_MODEL = 'llama3.2';
    const planner = new FixturePlanner();
    const spy = vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation(() =>
      (async function* () {
        yield 'x';
        return {
          sources: [{ notePath: 'n.md', nodeId: '1' }],
          groundingOutcome: 'answered',
          groundingPolicyVersion: 'v1',
        } satisfies ChatWorkflowResult;
      })(),
    );

    const runtime = new SidecarRuntime({ log, progress, planner });
    const chunks: ChatStreamChunk[] = [];
    const gen = runtime.handleChatStream({
      messages: [{ role: 'user', content: 'q' }],
      timeoutMs: 123,
      vaultOrganizationPrompt: 'Daily notes live under Daily/',
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
    });

    let step = await gen.next();
    while (!step.done) {
      chunks.push(step.value);
      step = await gen.next();
    }

    expect(chunks).toEqual([{ type: 'delta', delta: 'x' }]);
    expect(step.value).toMatchObject({
      sources: [{ notePath: 'n.md', nodeId: '1' }],
      groundingOutcome: 'answered',
      groundingPolicyVersion: 'v1',
    });
    const deps = spy.mock.calls[0]?.[0];
    const options = spy.mock.calls[0]?.[2];
    expect(deps?.planner).toBe(planner);
    expect(deps?.noteTools).toBeInstanceOf(AgentNoteToolRunner);
    expect(deps?.chat).toBeTruthy();
    expect(deps?.store).toBeTruthy();
    expect(deps?.embedder).toBeTruthy();
    expect(deps?.buildGroundedMessages).toBeTruthy();
    expect(options).toMatchObject({
      completion: { timeoutMs: 123 },
      modelConfigId: 'ollama:llama3.2',
      vaultIndexFingerprint: 'sqlite::memory:',
      vaultOrganizationPrompt: 'Daily notes live under Daily/',
      pathGlobs: ['Daily/**/*.md'],
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
    });
  });
});
