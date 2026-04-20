import { describe, expect, it, vi } from 'vitest';
import { chunkNote } from '@src/core/domain/chunker.js';
import type { ChunkNoteResult, DocumentNode, StoredSummary } from '@src/core/domain/types.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import { computeDirtyNodeIds, summarizeNote } from '@src/core/workflows/SummaryWorkflow.js';

function node(
  p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId' | 'type'>,
): DocumentNode {
  return {
    parentId: null,
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: '',
    contentHash: 'h0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

/** Minimal in-memory store for workflow tests. */
class MemoryStore implements IDocumentStore {
  private noteNodes = new Map<string, DocumentNode[]>();
  private summaries = new Map<string, StoredSummary>();

  seed(noteId: string, nodes: DocumentNode[]): void {
    this.noteNodes.set(noteId, nodes);
  }

  async upsertNodes(nodes: DocumentNode[]): Promise<void> {
    const ids = [...new Set(nodes.map((n) => n.noteId))];
    for (const nid of ids) {
      this.noteNodes.set(
        nid,
        nodes.filter((n) => n.noteId === nid),
      );
    }
  }

  async replaceNoteTags(): Promise<void> {}

  async replaceNoteCrossRefs(): Promise<void> {}

  async getNodesByNote(noteId: string): Promise<DocumentNode[]> {
    return [...(this.noteNodes.get(noteId) ?? [])];
  }

  async getNodeById(nodeId: string): Promise<DocumentNode | null> {
    for (const nodes of this.noteNodes.values()) {
      const found = nodes.find((n) => n.id === nodeId);
      if (found) return found;
    }
    return null;
  }

  async deleteNote(noteId: string): Promise<void> {
    this.noteNodes.delete(noteId);
  }

  async upsertSummary(
    nodeId: string,
    text: string,
    model: string,
    promptVersion: string,
  ): Promise<void> {
    this.summaries.set(nodeId, {
      summary: text,
      generatedAt: '2099-01-01T00:00:00.000Z',
      model,
      promptVersion,
    });
  }

  async getSummary(nodeId: string): Promise<StoredSummary | null> {
    return this.summaries.get(nodeId) ?? null;
  }

  async getEmbeddingMeta(): Promise<null> {
    return null;
  }

  async upsertEmbedding(): Promise<void> {}

  async searchSummaryVectors(): Promise<[]> {
    return [];
  }

  async searchContentVectors(): Promise<[]> {
    return [];
  }

  async getAncestors(): Promise<[]> {
    return [];
  }

  async getSiblings(): Promise<[]> {
    return [];
  }

  async getNoteMeta(): Promise<null> {
    return null;
  }

  async upsertNoteMeta(): Promise<void> {}

  async noteMatchesTagFilter(): Promise<boolean> {
    return true;
  }
}

function fakeChat(response: string): IChatPort {
  return {
    async *complete(_messages, _context, _apiKey, _options) {
      yield response;
    },
  };
}

describe('SummaryWorkflow', () => {
  it('B1_single_parent_two_leaves', async () => {
    const store = new MemoryStore();
    const chat = fakeChat('root summary');
    const spy = vi.spyOn(chat, 'complete');
    const md = 'First paragraph.\n\nSecond paragraph.\n';
    const parsed = chunkNote({
      noteId: 'n1',
      vaultPath: 'a.md',
      noteTitle: 'Doc',
      markdown: md,
    });
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'Doc',
        markdown: md,
        chatModelLabel: 'm1',
        precomputed: parsed,
      },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const root = parsed.nodes.find((n) => n.type === 'note');
    expect(root).toBeDefined();
    const sum = await store.getSummary(root!.id);
    expect(sum?.summary).toBe('root summary');
  });

  it('B2_post_order_depth_chain', async () => {
    const store = new MemoryStore();
    const upsertSpy = vi.spyOn(store, 'upsertSummary');
    const chat = fakeChat('x');
    const nNote = node({
      id: 'nid-note',
      noteId: 'n1',
      type: 'note',
      content: 'Root',
      contentHash: 'hn',
    });
    const nTopic = node({
      id: 'nid-topic',
      noteId: 'n1',
      parentId: 'nid-note',
      type: 'topic',
      depth: 1,
      siblingOrder: 0,
      headingTrail: ['H1'],
      content: 'H1',
      contentHash: 'ht',
    });
    const nSub = node({
      id: 'nid-sub',
      noteId: 'n1',
      parentId: 'nid-topic',
      type: 'subtopic',
      depth: 2,
      siblingOrder: 0,
      headingTrail: ['H1', 'H2'],
      content: 'H2',
      contentHash: 'hs',
    });
    const nPara = node({
      id: 'nid-para',
      noteId: 'n1',
      parentId: 'nid-sub',
      type: 'paragraph',
      depth: 3,
      siblingOrder: 0,
      headingTrail: ['H1', 'H2'],
      content: 'Body.',
      contentHash: 'hp',
    });
    const precomputed: ChunkNoteResult = {
      nodes: [nNote, nTopic, nSub, nPara],
      crossRefs: [],
      tags: [],
    };
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'x.md',
        noteTitle: 'T',
        markdown: '',
        chatModelLabel: 'm',
        precomputed,
      },
    );
    expect(upsertSpy.mock.calls.map((c) => c[0])).toEqual(['nid-sub', 'nid-topic', 'nid-note']);
  });

  it('C1_skip_fresh_summary', async () => {
    const store = new MemoryStore();
    const chat = fakeChat('once');
    const spy = vi.spyOn(chat, 'complete');
    const nNote = node({
      id: 'r1',
      noteId: 'n1',
      type: 'note',
      content: 'R',
      contentHash: 'a',
    });
    const p1 = node({
      id: 'p1',
      noteId: 'n1',
      parentId: 'r1',
      type: 'paragraph',
      depth: 1,
      siblingOrder: 0,
      content: 'L1',
      contentHash: 'b',
    });
    const p2 = node({
      id: 'p2',
      noteId: 'n1',
      parentId: 'r1',
      type: 'paragraph',
      depth: 1,
      siblingOrder: 1,
      content: 'L2',
      contentHash: 'c',
    });
    const precomputed: ChunkNoteResult = {
      nodes: [nNote, p1, p2],
      crossRefs: [],
      tags: [],
    };
    const input = {
      noteId: 'n1',
      vaultPath: 's.md',
      noteTitle: 'S',
      markdown: '',
      chatModelLabel: 'm',
      precomputed,
    };
    await summarizeNote({ chat, store }, input);
    expect(spy).toHaveBeenCalledTimes(1);
    store.seed('n1', precomputed.nodes);
    await summarizeNote({ chat, store }, input);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('C2_propagate_after_leaf_change', async () => {
    const store = new MemoryStore();
    let k = 0;
    const chat: IChatPort = {
      async *complete(_m, _c, _k, _o) {
        k += 1;
        yield `s${k}`;
      },
    };
    const nNote = node({
      id: 'r',
      noteId: 'n1',
      type: 'note',
      content: 'R',
      contentHash: 'r',
    });
    const nTopic = node({
      id: 't',
      noteId: 'n1',
      parentId: 'r',
      type: 'topic',
      depth: 1,
      siblingOrder: 0,
      headingTrail: ['H'],
      content: 'H',
      contentHash: 't',
    });
    const nLeaf = node({
      id: 'l',
      noteId: 'n1',
      parentId: 't',
      type: 'paragraph',
      depth: 2,
      siblingOrder: 0,
      headingTrail: ['H'],
      content: 'old',
      contentHash: 'old-hash',
    });
    const v1: ChunkNoteResult = {
      nodes: [nNote, nTopic, nLeaf],
      crossRefs: [],
      tags: [],
    };
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'c.md',
        noteTitle: 'C',
        markdown: '',
        chatModelLabel: 'm',
        precomputed: v1,
      },
    );
    expect(k).toBe(2);
    store.seed('n1', v1.nodes);
    const nLeaf2 = { ...nLeaf, content: 'new', contentHash: 'new-hash' };
    const v2: ChunkNoteResult = {
      nodes: [nNote, nTopic, nLeaf2],
      crossRefs: [],
      tags: [],
    };
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'c.md',
        noteTitle: 'C',
        markdown: '',
        chatModelLabel: 'm',
        precomputed: v2,
      },
    );
    expect(k).toBe(4);
  });

  it('Y1_core_import_boundary', () => {
    expect(import.meta.url).toContain('/tests/core/workflows/');
  });
});

describe('computeDirtyNodeIds', () => {
  it('marks ancestors when leaf hash changes', () => {
    const nNote = node({ id: 'r', noteId: 'n', type: 'note', contentHash: 'r' });
    const nTop = node({
      id: 't',
      noteId: 'n',
      parentId: 'r',
      type: 'topic',
      depth: 1,
      contentHash: 't',
    });
    const nLeaf = node({
      id: 'l',
      noteId: 'n',
      parentId: 't',
      type: 'paragraph',
      depth: 2,
      contentHash: 'h1',
    });
    const oldN = [nNote, nTop, nLeaf];
    const newN = [nNote, nTop, { ...nLeaf, contentHash: 'h2' }];
    const d = computeDirtyNodeIds(oldN, newN);
    expect(d.has('l')).toBe(true);
    expect(d.has('t')).toBe(true);
    expect(d.has('r')).toBe(true);
  });
});
