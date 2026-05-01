import { describe, expect, it, vi } from 'vitest';
import { createAgentPlannerPort } from '@src/sidecar/adapters/createAgentPlannerPort.js';

describe('createAgentPlannerPort', () => {
  it('A2_creates_ollama_planner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            role: 'assistant',
            content: JSON.stringify({
              task: 'Compile vault notes',
              topic: 'job search',
              filters: { pathGlobs: ['Daily/**/*.md'] },
              output: { kind: 'draft_note' },
              toolCalls: [{ id: 'search', type: 'search_notes', reason: 'Find notes', query: 'job search' }],
            }),
          },
          done: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const planner = createAgentPlannerPort('ollama', {
        baseUrl: ' http://127.0.0.1:11434/ ',
        model: ' llama3.1 ',
      });

      await expect(
        planner.planRetrieval({
          userPrompt: 'compile job search notes',
          conversation: [],
          anchorDate: '2026-05-01',
          modelConfigId: 'ollama:llama3.1',
          vaultIndexFingerprint: 'sqlite:test',
        }),
      ).resolves.toMatchObject({ status: 'ready' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(init.body as string) as { model: string };
      expect(body.model).toBe('llama3.1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
