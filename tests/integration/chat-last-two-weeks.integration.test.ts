import { describe, expect, it } from 'vitest';
import {
  type ResolverClock,
  resolveDateRangeFromPrompt,
} from '@src/core/domain/dateRangeResolver.js';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage, DocumentNode } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { chatWorkflowDeps } from './chatWorkflowDeps.js';
import { SearchTestStore } from '../core/workflows/searchTestStore.js';

function seedNode(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'paragraph',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'body',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function embed(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(4).fill(0.5));
    },
  };
}

class StubChat implements IChatPort {
  async *complete(
    _messages: ChatMessage[],
    _context: string,
    _key?: string,
    _opts?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    yield 'You had several job search touches in that window.';
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

describe('chat last-two-weeks binding (BUG-3)', () => {
  it('Y1_anchor_local_tz_when_defined', () => {
    const clock: ResolverClock = {
      now: () => new Date('2026-04-20T23:00:00.000Z'),
      timeZone: () => 'Europe/Berlin',
    };
    const r = resolveDateRangeFromPrompt('today', clock, { utcOffsetHoursFallback: 0 });
    expect(r?.dateRange.end).toBe('2026-04-21');
  });

  it('Y2_fallback_uses_utc_offset', () => {
    const orig = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...orig.call(this), timeZone: undefined };
    };
    try {
      const clock: ResolverClock = {
        now: () => new Date(Date.UTC(2026, 3, 20, 10, 0, 0)),
        timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const r = resolveDateRangeFromPrompt('today', clock, { utcOffsetHoursFallback: 14 });
      expect(r?.dateRange.end).toBe('2026-04-21');
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = orig;
    }
  });

  it('Y8_req006_s4_end_to_end', async () => {
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set(
      'jn',
      seedNode({
        id: 'jn',
        noteId: 'j1',
        content: 'Job search: applied to ExampleCorp and followed up by email.',
      }),
    );
    store.meta.set('j1', {
      noteId: 'j1',
      vaultPath: 'Daily/2026-04-10.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-04-10',
    });
    store.summaryHits = [{ nodeId: 'jn', score: 0.95 }];
    store.contentHits = [{ nodeId: 'jn', score: 0.85 }];

    const clock: ResolverClock = {
      now: () => new Date('2026-04-21T12:00:00.000Z'),
      timeZone: () => 'UTC',
    };

    const result = await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store, embed(), new StubChat()),
        [
          {
            role: 'user',
            content: 'List out my job search activities over the last 2 weeks',
          },
        ],
        {
          search: DEFAULT_SEARCH_ASSEMBLY,
          resolverClock: clock,
          timezoneUtcOffsetHours: 0,
          dailyNotePathGlobs: ['Daily/**/*.md'],
        },
      ),
    );

    expect(result.groundingOutcome).toBe('answered');
    expect(store.lastContentFilter?.dateRange?.start).toBe('2026-04-08');
    expect(store.lastContentFilter?.dateRange?.end).toBe('2026-04-21');
    expect(store.lastContentFilter?.pathRegex).toBeTruthy();
  });
});
