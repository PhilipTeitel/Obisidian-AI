import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '@src/sidecar/db/open.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';

describe('openDatabase', () => {
  it('creates_missing_parent_directory_for_file_db', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-open-'));
    const dbPath = path.join(tmp, 'nested', 'dir', 'vault.db');

    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);

    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT 1 as n').get() as { n: number };
    expect(row.n).toBe(1);
    expect(fs.existsSync(path.dirname(dbPath))).toBe(true);

    db.close();
  });

  it('loads_vec_module_when_reopening_existing_vector_db', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-open-'));
    const dbPath = path.join(tmp, 'vault.db');

    const first = openDatabase(dbPath, { embeddingDimension: 4 });
    first.close();

    const reopened = openDatabase(dbPath, { embeddingDimension: 4 });
    const store = new SqliteDocumentStore(reopened);
    await store.upsertNodes([
      {
        id: 'n1',
        noteId: 'note1',
        parentId: null,
        type: 'note',
        headingTrail: [],
        depth: 0,
        siblingOrder: 0,
        content: 'hello',
        contentHash: 'h',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await expect(
      store.upsertEmbedding('n1', 'content', new Float32Array([0.1, 0.2, 0.3, 0.4]), {
        model: 'm',
        dimension: 4,
        contentHash: 'h',
      }),
    ).resolves.toBeUndefined();

    reopened.close();
  });
});
