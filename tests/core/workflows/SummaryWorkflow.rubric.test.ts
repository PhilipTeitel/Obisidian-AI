import { describe, expect, it, vi } from 'vitest';
import { chunkNote } from '@src/core/domain/chunker.js';
import {
  SUMMARY_RUBRIC_MAX_CHARS,
  SUMMARY_RUBRIC_V1,
  SUMMARY_RUBRIC_VERSION,
} from '@src/core/domain/summaryPrompts.js';
import type { DocumentNode, StoredSummary } from '@src/core/domain/types.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import { summarizeNote } from '@src/core/workflows/SummaryWorkflow.js';

class RubricMemoryStore implements IDocumentStore {
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

  async searchSummaryVectors(_q: Float32Array, _k: number, _filter?: import('@src/core/domain/types.js').NodeFilter): Promise<[]> {
    return [];
  }

  async searchContentKeyword(): Promise<[]> {
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
    async *complete() {
      yield response;
    },
  };
}

function rubricFixture(text: string): string {
  return [
    'topics:',
    '- a',
    '',
    'entities:',
    '- b',
    '',
    'dates:',
    '- c',
    '',
    'actions:',
    '- d',
    '',
    'tags:',
    '- e',
    '',
    text,
  ]
    .join('\n')
    .trim();
}

describe('SummaryWorkflow rubric (WKF-4)', () => {
  it('A1_note_uses_rubric', async () => {
    const store = new RubricMemoryStore();
    const chat = fakeChat(rubricFixture(''));
    const spy = vi.spyOn(chat, 'complete');
    const md = 'First.\n\nSecond.\n';
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
    expect(spy).toHaveBeenCalled();
    const ctx = spy.mock.calls[0]?.[1] as string;
    for (const label of ['topics', 'entities', 'dates', 'actions', 'tags'] as const) {
      expect(ctx).toContain(`${label}:`);
    }
    expect(ctx).toContain(SUMMARY_RUBRIC_V1);
    expect(ctx).not.toMatch(/2[–-]4 sentences/);
  });

  it('A2_topic_and_subtopic_use_rubric', async () => {
    const store = new RubricMemoryStore();
    const chat = fakeChat(rubricFixture(''));
    const spy = vi.spyOn(chat, 'complete');
    const md = '## H1\n\nBody.\n\n### H2\n\nMore.\n';
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
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of spy.mock.calls) {
      const ctx = call[1] as string;
      for (const label of ['topics', 'entities', 'dates', 'actions', 'tags'] as const) {
        expect(ctx).toContain(`${label}:`);
      }
    }
  });

  it('A3_bullet_group_skipped', async () => {
    const store = new RubricMemoryStore();
    const chat = fakeChat(rubricFixture(''));
    const completeSpy = vi.spyOn(chat, 'complete');
    const upsertSpy = vi.spyOn(store, 'upsertSummary');
    const md = '- only bullet under root list\n';
    const parsed = chunkNote({
      noteId: 'n1',
      vaultPath: 'a.md',
      noteTitle: 'Doc',
      markdown: md,
    });
    const bulletGroup = parsed.nodes.find((n) => n.type === 'bullet_group');
    expect(bulletGroup).toBeDefined();
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
    const bgId = bulletGroup!.id;
    expect(upsertSpy.mock.calls.every((c) => c[0] !== bgId)).toBe(true);
    expect(await store.getSummary(bgId)).toBeNull();
    expect(completeSpy).toHaveBeenCalled();
  });

  it('B2_per_field_caps', async () => {
    const manyTopics = Array.from({ length: 20 }, (_, i) => `- topic-${i}`).join('\n');
    const oversized = [
      'topics:',
      manyTopics,
      '',
      'entities:',
      '- e1',
      '',
      'dates:',
      '',
      'actions:',
      '',
      'tags:',
      '',
    ].join('\n');
    const store = new RubricMemoryStore();
    const chat = fakeChat(oversized);
    const md = 'a\n\nb\n';
    const parsed = chunkNote({ noteId: 'n1', vaultPath: 'a.md', noteTitle: 'D', markdown: md });
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
        chatModelLabel: 'm',
        precomputed: parsed,
      },
    );
    const root = parsed.nodes.find((n) => n.type === 'note')!;
    const sum = await store.getSummary(root.id);
    const topicBullets = (sum!.summary.split('entities:')[0]?.match(/^\s*-\s/gm) ?? []).length;
    expect(topicBullets).toBeLessThanOrEqual(10);
  });

  it('B3_empty_fields_well_formed', async () => {
    const sparse = [
      'topics:',
      '',
      'entities:',
      '',
      'dates:',
      '',
      'actions:',
      '',
      'tags:',
      '',
    ].join('\n');
    const store = new RubricMemoryStore();
    const chat = fakeChat(sparse);
    const md = 'x\n\ny\n';
    const parsed = chunkNote({ noteId: 'n1', vaultPath: 'a.md', noteTitle: 'D', markdown: md });
    await expect(
      summarizeNote(
        { chat, store },
        {
          noteId: 'n1',
          vaultPath: 'a.md',
          noteTitle: 'D',
          markdown: md,
          chatModelLabel: 'm',
          precomputed: parsed,
        },
      ),
    ).resolves.toBeUndefined();
    const root = parsed.nodes.find((n) => n.type === 'note')!;
    const sum = await store.getSummary(root.id);
    for (const label of ['topics', 'entities', 'dates', 'actions', 'tags'] as const) {
      expect(sum!.summary).toContain(`${label}:`);
    }
  });

  it('B4_no_fabrication', async () => {
    const sparse = [
      'topics:',
      '',
      'entities:',
      '',
      'dates:',
      '',
      'actions:',
      '',
      'tags:',
      '',
    ].join('\n');
    const store = new RubricMemoryStore();
    const chat = fakeChat(sparse);
    const md = 'a\n\nb\n';
    const parsed = chunkNote({ noteId: 'n1', vaultPath: 'a.md', noteTitle: 'D', markdown: md });
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
        chatModelLabel: 'm',
        precomputed: parsed,
      },
    );
    const root = parsed.nodes.find((n) => n.type === 'note')!;
    expect((await store.getSummary(root.id))!.summary.trim()).toBe(sparse.trim());
  });

  it('C1_truncation_logged_at_warn', async () => {
    const huge = `${rubricFixture('')}\n${'word '.repeat(SUMMARY_RUBRIC_MAX_CHARS)}`;
    const store = new RubricMemoryStore();
    const chat = fakeChat(huge);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const md = 'a\n\nb\n';
    const parsed = chunkNote({ noteId: 'n1', vaultPath: 'a.md', noteTitle: 'D', markdown: md });
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
        chatModelLabel: 'm',
        precomputed: parsed,
      },
    );
    const root = parsed.nodes.find((n) => n.type === 'note')!;
    const sum = await store.getSummary(root.id);
    expect(sum!.summary.length).toBeLessThanOrEqual(SUMMARY_RUBRIC_MAX_CHARS);
    expect(warnSpy.mock.calls.length).toBe(1);
    const arg1 = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(arg1.nodeId).toBe(root.id);
    expect(arg1.nodeType).toBe('note');
    expect(arg1.preTruncationSize).toBe(huge.trim().length);
    warnSpy.mockRestore();
  });

  it('D2_legacy_version_regenerates', async () => {
    const store = new RubricMemoryStore();
    const md = 'a\n\nb\n';
    const parsed = chunkNote({ noteId: 'n1', vaultPath: 'a.md', noteTitle: 'D', markdown: md });
    const root = parsed.nodes.find((n) => n.type === 'note')!;
    await store.upsertNodes(parsed.nodes);
    await store.upsertSummary(root.id, 'old', 'm0', 'legacy');
    store.seed('n1', parsed.nodes);
    let calls = 0;
    const chat: IChatPort = {
      async *complete() {
        calls += 1;
        yield rubricFixture('');
      },
    };
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
        chatModelLabel: 'm',
        precomputed: parsed,
      },
    );
    expect(calls).toBe(1);
    expect((await store.getSummary(root.id))?.promptVersion).toBe(SUMMARY_RUBRIC_VERSION);
  });

  it('D3_hash_and_version_match_skips', async () => {
    const store = new RubricMemoryStore();
    const md = 'a\n\nb\n';
    const parsed = chunkNote({ noteId: 'n1', vaultPath: 'a.md', noteTitle: 'D', markdown: md });
    await store.seed('n1', parsed.nodes);
    await summarizeNote(
      { chat: fakeChat(rubricFixture('')), store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
        chatModelLabel: 'm',
        precomputed: parsed,
      },
    );
    const chat = fakeChat('should-not-run');
    const completeSpy = vi.spyOn(chat, 'complete');
    const upsertSpy = vi.spyOn(store, 'upsertSummary');
    await summarizeNote(
      { chat, store },
      {
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
        chatModelLabel: 'm',
        precomputed: parsed,
      },
    );
    expect(completeSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
