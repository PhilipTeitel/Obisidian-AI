import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chunkNote } from '@src/core/domain/chunker.js';
import {
  SUMMARY_RUBRIC_MAX_CHARS,
  SUMMARY_RUBRIC_VERSION,
} from '@src/core/domain/summaryPrompts.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import { summarizeNote } from '@src/core/workflows/SummaryWorkflow.js';
import { assertPromptVersionRoundTrip } from '../../core/ports/IDocumentStore.contract.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { openDatabase } from '@src/sidecar/db/open.js';

const DIM = 4;

function rubricOut(): string {
  return [
    'topics:',
    '- t',
    '',
    'entities:',
    '- e',
    '',
    'dates:',
    '- d',
    '',
    'actions:',
    '- a',
    '',
    'tags:',
    '- g',
    '',
  ].join('\n');
}

function makeStore(): { store: SqliteDocumentStore; db: ReturnType<typeof openDatabase> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkf4-'));
  const dbPath = path.join(dir, 'wkf-4-summaries.db');
  const db = openDatabase(dbPath, { embeddingDimension: DIM });
  return { store: new SqliteDocumentStore(db), db };
}

describe('SqliteDocumentStore summaries promptVersion (WKF-4)', () => {
  it('D1_round_trip', async () => {
    const { store, db } = makeStore();
    try {
      await store.upsertNodes([
        {
          id: 'n1',
          noteId: 'note1',
          parentId: null,
          type: 'note',
          headingTrail: [],
          depth: 0,
          siblingOrder: 0,
          content: 'T',
          contentHash: 'h',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      await store.upsertSummary('n1', 'hello', 'gpt', SUMMARY_RUBRIC_VERSION);
      const row = await store.getSummary('n1');
      expect(row?.promptVersion).toBe(SUMMARY_RUBRIC_VERSION);
    } finally {
      db.close();
    }
  });

  it('Y8_adapter_persists_prompt_version', async () => {
    const { store, db } = makeStore();
    try {
      await assertPromptVersionRoundTrip(store);
      const raw = db
        .prepare('SELECT prompt_version FROM summaries WHERE node_id = ?')
        .get('n_contract') as { prompt_version: string };
      expect(raw.prompt_version).toBe(SUMMARY_RUBRIC_VERSION);
    } finally {
      db.close();
    }
  });

  it('Y4_summary_text_verbatim', async () => {
    const { store, db } = makeStore();
    try {
      await store.upsertNodes([
        {
          id: 'n1',
          noteId: 'note1',
          parentId: null,
          type: 'note',
          headingTrail: [],
          depth: 0,
          siblingOrder: 0,
          content: 'T',
          contentHash: 'h',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      const text = rubricOut();
      await store.upsertSummary('n1', text, 'm', SUMMARY_RUBRIC_VERSION);
      const row = await store.getSummary('n1');
      expect(row?.summary).toBe(text);
    } finally {
      db.close();
    }
  });

  it('Y5_truncation_respects_budget_in_sqlite', async () => {
    const { store, db } = makeStore();
    try {
      const md = 'a\n\nb\n';
      const parsed = chunkNote({
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
      });
      await store.upsertNodes(parsed.nodes);
      const huge = `${rubricOut()}\n${'word '.repeat(SUMMARY_RUBRIC_MAX_CHARS)}`;
      const chat: IChatPort = {
        async *complete() {
          yield huge;
        },
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      const row = db.prepare('SELECT summary FROM summaries WHERE node_id = ?').get(root.id) as {
        summary: string;
      };
      expect(row.summary.length).toBeLessThanOrEqual(SUMMARY_RUBRIC_MAX_CHARS);
      expect(warnSpy.mock.calls.length).toBe(1);
      warnSpy.mockRestore();
    } finally {
      db.close();
    }
  });

  it('Y2_bullet_group_no_row_no_vector', async () => {
    const { store, db } = makeStore();
    try {
      const md = '- item one\n';
      const parsed = chunkNote({
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
      });
      await store.upsertNodes(parsed.nodes);
      const bg = parsed.nodes.filter((n) => n.type === 'bullet_group');
      expect(bg.length).toBeGreaterThan(0);
      const chat: IChatPort = {
        async *complete() {
          yield rubricOut();
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
      for (const n of bg) {
        expect(await store.getSummary(n.id)).toBeNull();
      }
      const bad = db
        .prepare(
          `SELECT COUNT(*) AS c FROM summaries s
           INNER JOIN nodes n ON n.id = s.node_id
           WHERE n.type = 'bullet_group'`,
        )
        .get() as { c: number };
      expect(bad.c).toBe(0);
      const vbad = db
        .prepare(
          `SELECT COUNT(*) AS c FROM vec_summary v
           INNER JOIN nodes n ON n.id = v.node_id
           WHERE n.type = 'bullet_group'`,
        )
        .get() as { c: number };
      expect(vbad.c).toBe(0);
    } finally {
      db.close();
    }
  });

  it('A4_bullet_still_retrievable', async () => {
    const { store, db } = makeStore();
    try {
      const md = '## Section\n\n- uniqueTokenForSearch\n';
      const parsed = chunkNote({
        noteId: 'n1',
        vaultPath: 'v/a.md',
        noteTitle: 'T',
        markdown: md,
      });
      await store.upsertNodes(parsed.nodes);
      const bullet = parsed.nodes.find(
        (n) => n.type === 'bullet' && n.content.includes('uniqueTokenForSearch'),
      );
      const subtopic = parsed.nodes.find((n) => n.type === 'subtopic');
      expect(bullet).toBeDefined();
      expect(subtopic).toBeDefined();
      const v = new Float32Array(DIM).fill(0.35);
      await store.upsertEmbedding(bullet!.id, 'content', v, {
        model: 'emb',
        dimension: DIM,
        contentHash: bullet!.contentHash,
      });
      const hits = await store.searchContentVectors(v, 8, {
        subtreeRootNodeIds: [subtopic!.id],
      });
      expect(hits.some((h) => h.nodeId === bullet!.id)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('Y6_version_staleness', async () => {
    const { store, db } = makeStore();
    try {
      const md = 'x\n\ny\n';
      const parsed = chunkNote({
        noteId: 'n1',
        vaultPath: 'a.md',
        noteTitle: 'D',
        markdown: md,
      });
      const root = parsed.nodes.find((n) => n.type === 'note')!;
      await store.upsertNodes(parsed.nodes);
      db.prepare(
        `INSERT INTO summaries (node_id, summary, model, prompt_version, generated_at)
         VALUES (?, 'legacy text', 'old', 'legacy', datetime('now'))`,
      ).run(root.id);

      let calls = 0;
      const chat: IChatPort = {
        async *complete() {
          calls += 1;
          yield rubricOut();
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

      const chat2: IChatPort = {
        async *complete() {
          calls += 1;
          yield 'should-not-run';
        },
      };
      await summarizeNote(
        { chat: chat2, store },
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
    } finally {
      db.close();
    }
  });
});
