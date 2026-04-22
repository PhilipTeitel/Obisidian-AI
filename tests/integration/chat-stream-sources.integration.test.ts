import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
import type { ChatMessage, DocumentNode } from '@src/core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import { type ChatWorkflowResult, runChatStream } from '@src/core/workflows/ChatWorkflow.js';
import { VAULT_CONTEXT_PREFIX } from '@src/sidecar/adapters/chatProviderMessages.js';
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

class CaptureStreamChat implements IChatPort {
  lastMessages: ChatMessage[] | null = null;
  async *complete(
    messages: ChatMessage[],
    _context: string,
    _key?: string,
    _opts?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    this.lastMessages = messages;
    yield 'partial';
    yield ' delta';
  }
}

function vaultContextFromMessages(messages: ChatMessage[]): string {
  const sys = messages.find(
    (m) => m.role === 'system' && m.content.startsWith(VAULT_CONTEXT_PREFIX),
  );
  if (!sys) {
    throw new Error('expected vault context system message');
  }
  return sys.content.slice(VAULT_CONTEXT_PREFIX.length);
}

async function drainChatStream(
  gen: AsyncGenerator<string, ChatWorkflowResult>,
): Promise<ChatWorkflowResult> {
  for (;;) {
    const n = await gen.next();
    if (n.done) return n.value;
  }
}

function storeWithNotes(
  hits: { id: string; noteId: string; vaultPath: string; content: string }[],
): SearchTestStore {
  const store = new SearchTestStore();
  store.nodes.clear();
  store.meta.clear();
  for (const h of hits) {
    store.nodes.set(
      h.id,
      seedNode({
        id: h.id,
        noteId: h.noteId,
        content: h.content,
        headingTrail: ['H'],
      }),
    );
    store.meta.set(h.noteId, {
      noteId: h.noteId,
      vaultPath: h.vaultPath,
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
  }
  store.summaryHits = hits.map((h, i) => ({ nodeId: h.id, score: 0.1 + i * 0.01 }));
  store.contentHits = hits.map((h, i) => ({ nodeId: h.id, score: 0.05 + i * 0.01 }));
  store.keywordHits = [];
  return store;
}

describe('chat stream sources integration (BUG-1)', () => {
  it('Y1_bidirectional_equality_real_stream', async () => {
    const store = storeWithNotes([
      { id: 'x1', noteId: 'a', vaultPath: 'notes/first.md', content: 'TOKEN_ONE unique-a' },
      { id: 'x2', noteId: 'b', vaultPath: 'notes/second.md', content: 'TOKEN_TWO unique-b' },
    ]);
    const chat = new CaptureStreamChat();
    const messages: ChatMessage[] = [{ role: 'user', content: 'question' }];
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), messages, {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result.groundingOutcome).toBe('answered');
    expect(result.sources).toHaveLength(2);
    const ctx = vaultContextFromMessages(chat.lastMessages!);
    for (const s of result.sources) {
      expect(ctx).toContain(s.notePath);
    }
    expect(ctx).toContain('TOKEN_ONE');
    expect(ctx).toContain('TOKEN_TWO');
    const pathsInSources = new Set(result.sources.map((s) => s.notePath));
    expect(pathsInSources.has('notes/first.md')).toBe(true);
    expect(pathsInSources.has('notes/second.md')).toBe(true);
  });

  it('Y2_aggregation_all_contributors', async () => {
    const store = storeWithNotes([
      { id: 'a', noteId: 'na', vaultPath: 'daily/a.md', content: 'activity one' },
      { id: 'b', noteId: 'nb', vaultPath: 'daily/b.md', content: 'activity two' },
      { id: 'c', noteId: 'nc', vaultPath: 'daily/c.md', content: 'activity three' },
    ]);
    const chat = new CaptureStreamChat();
    const result = await drainChatStream(
      runChatStream(
        chatWorkflowDeps(store, embed(), chat),
        [{ role: 'user', content: 'How many activities this month?' }],
        { search: DEFAULT_SEARCH_ASSEMBLY },
      ),
    );
    const paths = result.sources.map((s) => s.notePath).sort();
    expect(paths).toEqual(['daily/a.md', 'daily/b.md', 'daily/c.md']);
  });

  it('Y3_filter_excluded_never_in_sources', async () => {
    const store = new SearchTestStore();
    store.nodes.clear();
    store.meta.clear();
    store.nodes.set('d1', seedNode({ id: 'd1', noteId: 'nd', content: 'daily hit' }));
    store.nodes.set('p1', seedNode({ id: 'p1', noteId: 'np', content: 'proj hit' }));
    store.meta.set('nd', {
      noteId: 'nd',
      vaultPath: 'daily/2026-04-21.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    store.meta.set('np', {
      noteId: 'np',
      vaultPath: 'projects/pitch.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
    });
    store.summaryHits = [
      { nodeId: 'd1', score: 0.1 },
      { nodeId: 'p1', score: 0.09 },
    ];
    store.contentHits = [
      { nodeId: 'd1', score: 0.05 },
      { nodeId: 'p1', score: 0.04 },
    ];
    store.keywordHits = [];

    const chat = new CaptureStreamChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
        pathGlobs: ['daily/**'],
      }),
    );
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.notePath).toBe('daily/2026-04-21.md');
    const ctx = vaultContextFromMessages(chat.lastMessages!);
    expect(ctx).toContain('daily/2026-04-21.md');
    expect(ctx).not.toContain('projects/pitch.md');
  });

  it('Y4_insufficient_evidence_empty', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const chat = new CaptureStreamChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result.sources).toEqual([]);
    expect(result.groundingOutcome).toBe('insufficient_evidence');
    expect(chat.lastMessages).toBeNull();
  });
});
