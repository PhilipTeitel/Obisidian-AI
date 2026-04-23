/**
 * End-to-end-ish: full user sentences go through {@link runChatStream} → {@link runSearch},
 * so retrieval sees the same query string the user typed (embed + BM25), not only parsed dates.
 *
 * Dependencies: Vitest, core workflows, {@link SearchTestStore} (in-memory fake store — no Obsidian).
 * Heavier SQLite integration lives in `SqliteDocumentStore.filters.test.ts` + contract B7 (path LIKE + note_date).
 */
import { describe, expect, it } from 'vitest';
import type { ResolverClock } from '@src/core/domain/dateRangeResolver.js';
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

function recordingEmbedder(out: string[][]): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      out.push([...texts]);
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

const clockUtcApr21: ResolverClock = {
  now: () => new Date('2026-04-21T12:00:00.000Z'),
  timeZone: () => 'UTC',
};

describe('chat NL date queries — full user message through retrieval (BUG-3)', () => {
  it('from_iso_onwards_passes_whole_prompt_to_embed_and_keyword', async () => {
    const userMsg =
      'What are the job search activities from 2026-04-15 onwards';
    const embedBatches: string[][] = [];
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set(
      'jn',
      seedNode({
        id: 'jn',
        noteId: 'j1',
        content: 'Job search: phone screen with Acme.',
      }),
    );
    store.meta.set('j1', {
      noteId: 'j1',
      vaultPath: 'daily/2026-04-18.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-04-18',
    });
    store.summaryHits = [{ nodeId: 'jn', score: 0.95 }];
    store.contentHits = [{ nodeId: 'jn', score: 0.85 }];
    store.keywordHits = [{ nodeId: 'jn', score: 0.1 }];

    const result = await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store, recordingEmbedder(embedBatches), new StubChat()),
        [{ role: 'user', content: userMsg }],
        {
          search: DEFAULT_SEARCH_ASSEMBLY,
          resolverClock: clockUtcApr21,
          timezoneUtcOffsetHours: 0,
          dailyNotePathGlobs: ['daily/**/*.md'],
          enableHybridSearch: true,
        },
      ),
    );

    expect(result.groundingOutcome).toBe('answered');
    expect(store.lastContentFilter?.dateRange).toEqual({
      start: '2026-04-15',
      end: '2026-04-21',
    });
    expect(store.lastContentFilter?.pathRegex).toBeTruthy();
    expect(embedBatches.length).toBeGreaterThan(0);
    expect(embedBatches[0]![0]).toBe(userMsg);
    expect(store.lastKeywordQuery).toBe(userMsg);
  });

  it('on_iso_passes_whole_prompt_to_embed_and_keyword', async () => {
    const userMsg =
      'what job search related activities were done on 2026-04-16';
    const embedBatches: string[][] = [];
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set(
      'jn',
      seedNode({
        id: 'jn',
        noteId: 'j1',
        content: 'Job search: applied to Beta LLC.',
      }),
    );
    store.meta.set('j1', {
      noteId: 'j1',
      vaultPath: 'daily/2026-04-16.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-04-16',
    });
    store.summaryHits = [{ nodeId: 'jn', score: 0.95 }];
    store.contentHits = [{ nodeId: 'jn', score: 0.85 }];
    store.keywordHits = [{ nodeId: 'jn', score: 0.1 }];

    const result = await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store, recordingEmbedder(embedBatches), new StubChat()),
        [{ role: 'user', content: userMsg }],
        {
          search: DEFAULT_SEARCH_ASSEMBLY,
          resolverClock: clockUtcApr21,
          timezoneUtcOffsetHours: 0,
          dailyNotePathGlobs: ['daily/**/*.md'],
          enableHybridSearch: true,
        },
      ),
    );

    expect(result.groundingOutcome).toBe('answered');
    expect(store.lastContentFilter?.dateRange).toEqual({
      start: '2026-04-16',
      end: '2026-04-16',
    });
    expect(embedBatches[0]![0]).toBe(userMsg);
    expect(store.lastKeywordQuery).toBe(userMsg);
  });
});
