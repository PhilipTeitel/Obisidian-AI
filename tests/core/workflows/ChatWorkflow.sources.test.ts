import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';
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

class RecordingChat implements IChatPort {
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

describe('ChatWorkflow.sources (BUG-1)', () => {
  it('A1_one_record_per_stitched_snippet', async () => {
    const store = storeWithNotes([
      { id: 'n1', noteId: 'a', vaultPath: 'one.md', content: 'alpha UNIQUE_A' },
      { id: 'n2', noteId: 'b', vaultPath: 'two.md', content: 'beta UNIQUE_B' },
    ]);
    const chat = new RecordingChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result.sources).toHaveLength(2);
    const paths = result.sources.map((s) => s.notePath).sort();
    expect(paths).toEqual(['one.md', 'two.md']);
    const ctxMsg = chat.lastCall?.messages.find(
      (m) => m.role === 'system' && m.content.includes('Vault context'),
    );
    expect(ctxMsg?.content).toContain('one.md');
    expect(ctxMsg?.content).toContain('two.md');
  });

  it('A2_dedup_preserves_insertion_order', async () => {
    const store = storeWithNotes([
      { id: 'first', noteId: 'same', vaultPath: 'dup.md', content: 'first block UNIQUE_FIRST' },
      { id: 'mid', noteId: 'other', vaultPath: 'other.md', content: 'mid block' },
      { id: 'third', noteId: 'same', vaultPath: 'dup.md', content: 'third block UNIQUE_THIRD' },
    ]);
    const chat = new RecordingChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.notePath).toBe('dup.md');
    expect(result.sources[0]?.nodeId).toBe('first');
    expect(result.sources[1]?.notePath).toBe('other.md');
  });

  it('A3_aggregation_lists_all_contributors', async () => {
    const store = storeWithNotes([
      { id: 'a', noteId: 'na', vaultPath: 'daily/a.md', content: 'job A' },
      { id: 'b', noteId: 'nb', vaultPath: 'daily/b.md', content: 'job B' },
      { id: 'c', noteId: 'nc', vaultPath: 'daily/c.md', content: 'job C' },
    ]);
    const chat = new RecordingChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result.sources).toHaveLength(3);
    expect(new Set(result.sources.map((s) => s.notePath)).size).toBe(3);
  });

  it('A4_budget_drop_excludes_source', async () => {
    const store = storeWithNotes([
      { id: 'n1', noteId: 'a', vaultPath: 'one.md', content: 'small UNIQUE_SMALL' },
      {
        id: 'n2',
        noteId: 'b',
        vaultPath: 'two.md',
        content: `${'LONGCHUNK '.repeat(400)} UNIQUE_LOST`,
      },
    ]);
    const chat = new RecordingChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: {
          ...DEFAULT_SEARCH_ASSEMBLY,
          chatStitchMaxTokens: 120,
        },
      }),
    );
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.notePath).toBe('one.md');
    const ctxMsg = chat.lastCall?.messages.find(
      (m) => m.role === 'system' && m.content.includes('Vault context'),
    );
    expect(ctxMsg?.content).toContain('one.md');
    expect(ctxMsg?.content).not.toContain('UNIQUE_LOST');
  });

  it('A5_insufficient_evidence_empty_sources', async () => {
    const store = new SearchTestStore();
    store.summaryHits = [];
    store.keywordHits = [];
    store.contentHits = [];
    const chat = new RecordingChat();
    const result = await drainChatStream(
      runChatStream(chatWorkflowDeps(store, embed(), chat), [{ role: 'user', content: 'q' }], {
        search: DEFAULT_SEARCH_ASSEMBLY,
      }),
    );
    expect(result.sources).toEqual([]);
    expect(result.groundingOutcome).toBe('insufficient_evidence');
    expect(chat.lastCall).toBeNull();
  });
});
