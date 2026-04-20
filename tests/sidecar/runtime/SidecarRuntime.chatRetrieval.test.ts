import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { validateSearchAssemblyOptions } from '@src/core/domain/contextAssembly.js';
import type { ChatWorkflowOptions } from '@src/core/workflows/ChatWorkflow.js';
import * as ChatWorkflow from '@src/core/workflows/ChatWorkflow.js';
import * as SearchWorkflow from '@src/core/workflows/SearchWorkflow.js';
import { ProgressAdapter } from '@src/sidecar/adapters/ProgressAdapter.js';
import { SidecarRuntime } from '@src/sidecar/runtime/SidecarRuntime.js';

function asmAlt() {
  const o = {
    budget: { matchedContent: 0.7, siblingContext: 0.2, parentSummary: 0.1 },
    totalTokenBudget: 400,
  };
  validateSearchAssemblyOptions(o);
  return o;
}

async function drainChatStream(
  gen: AsyncGenerator<{ type: string; delta?: string }, { sources: { notePath: string }[] }>,
): Promise<void> {
  let step = await gen.next();
  while (!step.done) {
    step = await gen.next();
  }
}

describe('SidecarRuntime chat retrieval (RET-4)', () => {
  const log = pino({ level: 'silent' });
  const progress = new ProgressAdapter({});

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OBSIDIAN_AI_DB_PATH;
  });

  it('C1_settings_propagate_to_chat_S5', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    let optionsPassed: ChatWorkflowOptions | undefined;
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_d, _m, opts) => {
      optionsPassed = opts;
      return (async function* () {
        yield '';
        return { sources: [] };
      })();
    });
    const runtime = new SidecarRuntime({ log, progress });
    const gen = runtime.handleChatStream({
      messages: [{ role: 'user', content: 'hi' }],
      coarseK: 48,
      search: asmAlt(),
      k: 15,
    });
    await drainChatStream(gen);
    expect(optionsPassed?.coarseK).toBe(48);
    expect(optionsPassed?.k).toBe(15);
    expect(optionsPassed?.search).toEqual(asmAlt());
  });

  it('Y2_sidecar_threads_chatCoarseK', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const searchSpy = vi.spyOn(SearchWorkflow, 'runSearch').mockResolvedValue({ results: [] });
    let chatOpts: ChatWorkflowOptions | undefined;
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_d, _m, opts) => {
      chatOpts = opts;
      return (async function* () {
        yield '';
        return { sources: [] };
      })();
    });
    const runtime = new SidecarRuntime({ log, progress });
    const a = asmAlt();
    await runtime.handleSend({ type: 'search', payload: { query: 'q', coarseK: 77, search: a } });
    expect(searchSpy.mock.calls[0]?.[1].coarseK).toBe(77);
    const gen = runtime.handleChatStream({
      messages: [{ role: 'user', content: 'x' }],
      coarseK: 77,
      search: a,
    });
    await drainChatStream(gen);
    expect(chatOpts?.coarseK).toBe(77);
  });

  it('Y4_no_default_search_assembly_hardcode_S5', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const custom = asmAlt();
    let optionsPassed: ChatWorkflowOptions | undefined;
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_d, _m, opts) => {
      optionsPassed = opts;
      return (async function* () {
        yield '';
        return { sources: [] };
      })();
    });
    const runtime = new SidecarRuntime({ log, progress });
    await drainChatStream(
      runtime.handleChatStream({
        messages: [{ role: 'user', content: 'hi' }],
        search: custom,
      }),
    );
    expect(optionsPassed?.search).toEqual(custom);
  });

  it('RET5_enableHybridSearch_threads_from_chat_payload', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    let optionsPassed: ChatWorkflowOptions | undefined;
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_d, _m, opts) => {
      optionsPassed = opts;
      return (async function* () {
        yield '';
        return { sources: [] };
      })();
    });
    const runtime = new SidecarRuntime({ log, progress });
    await drainChatStream(
      runtime.handleChatStream({
        messages: [{ role: 'user', content: 'hi' }],
        enableHybridSearch: false,
        search: asmAlt(),
      }),
    );
    expect(optionsPassed?.enableHybridSearch).toBe(false);
  });

  it('D2_runtime_setting_change_S10', async () => {
    process.env.OBSIDIAN_AI_DB_PATH = ':memory:';
    const coarseKs: number[] = [];
    vi.spyOn(ChatWorkflow, 'runChatStream').mockImplementation((_d, _m, opts) => {
      coarseKs.push(opts.coarseK ?? -1);
      return (async function* () {
        yield '';
        return { sources: [] };
      })();
    });
    const runtime = new SidecarRuntime({ log, progress });
    const s = asmAlt();
    await drainChatStream(
      runtime.handleChatStream({
        messages: [{ role: 'user', content: 'a' }],
        coarseK: 8,
        search: s,
      }),
    );
    await drainChatStream(
      runtime.handleChatStream({
        messages: [{ role: 'user', content: 'b' }],
        coarseK: 64,
        search: s,
      }),
    );
    expect(coarseKs).toEqual([8, 64]);
  });
});
