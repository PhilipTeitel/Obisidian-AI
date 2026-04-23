import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ResolverClock } from '@src/core/domain/dateRangeResolver.js';
import type { ChatMessage, DocumentNode } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { chatWorkflowDeps } from '../../integration/chatWorkflowDeps.js';
import { SearchTestStore } from './searchTestStore.js';

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
    yield '';
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

describe('ChatWorkflow.dateRange (BUG-3)', () => {
  it('Y7_compose_pathGlobs_with_dateRange', async () => {
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set(
      'n1',
      seedNode({
        id: 'n1',
        noteId: 'daily1',
        content: 'job search call with Alice',
      }),
    );
    store.meta.set('daily1', {
      noteId: 'daily1',
      vaultPath: 'Daily/2026-04-10.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-04-10',
    });
    store.summaryHits = [{ nodeId: 'n1', score: 0.9 }];
    store.contentHits = [{ nodeId: 'n1', score: 0.8 }];

    const clock: ResolverClock = {
      now: () => new Date('2026-04-21T12:00:00.000Z'),
      timeZone: () => 'UTC',
    };
    const log = { debug: vi.fn(), info: vi.fn() };
    const deps = { ...chatWorkflowDeps(store, embed(), new StubChat()), log };
    await drainChatStream(
      runChatStream(deps, [{ role: 'user', content: 'job search over the last 2 weeks' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
        resolverClock: clock,
        timezoneUtcOffsetHours: 0,
        dailyNotePathGlobs: ['Daily/**/*.md'],
      }),
    );

    expect(store.lastContentFilter?.dateRange).toEqual({
      start: '2026-04-08',
      end: '2026-04-21',
    });
    expect(store.lastContentFilter?.pathRegex).toBeTruthy();
    expect(store.lastContentFilter?.pathLikes?.length).toBeGreaterThan(0);
    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        matchRuleId: 'last_n_weeks',
        dateRange: { start: '2026-04-08', end: '2026-04-21' },
        pathGlobs: ['Daily/**/*.md'],
      }),
      'chat.date_range_resolved',
    );
    expect(log.info).toHaveBeenCalledWith(
      { naturalLanguageDateFilterApplied: true },
      'chat.nl_date_filter_applied',
    );
  });
});
