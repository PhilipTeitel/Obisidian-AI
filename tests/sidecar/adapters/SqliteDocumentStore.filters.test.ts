import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chunker from '@src/core/domain/chunker.js';
import type {
  DocumentNode,
  NodeFilter,
  NoteIndexJob,
  QueueItem,
} from '@src/core/domain/types.js';
import * as summaryWorkflow from '@src/core/workflows/SummaryWorkflow.js';
import { processOneJob } from '@src/core/workflows/IndexWorkflow.js';
import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import type { IJobStepPort } from '@src/core/ports/IJobStepPort.js';
import type { IQueuePort } from '@src/core/ports/IQueuePort.js';
import type { IndexWorkflowDeps } from '@src/core/workflows/IndexWorkflow.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { loadSqliteVec } from '@src/sidecar/db/load-sqlite-vec.js';
import { openDatabase } from '@src/sidecar/db/open.js';
import {
  runB1SingleGlobContract,
  runB2UnionGlobsContract,
  runB3DateRangeInclusiveContract,
  runB4NullNoteDateExcludedContract,
  runB5IntersectionContract,
  runB6NoteDateRoundTripContract,
} from '../../contract/document-store.filters.contract.js';
import { runSearch } from '@src/core/workflows/SearchWorkflow.js';
import { DEFAULT_SEARCH_ASSEMBLY } from '@src/core/domain/contextAssembly.js';

const dim = 4;
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dbPath = path.join(rootDir, 'var/test/ret6-filters.db');

function openRet6Db() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {
    /* best-effort */
  }
  const db = openDatabase(dbPath, { embeddingDimension: dim });
  loadSqliteVec(db);
  return db;
}

class JobStepsStub implements IJobStepPort {
  ensureJob(): void {}
  transitionStep(): void {}
  markFailed(): void {}
  listRecoverableJobs() {
    return [];
  }
  deleteJobForNotePath(): void {}
  listJobSteps() {
    return [];
  }
}

class QueueStub implements IQueuePort<NoteIndexJob> {
  async enqueue(): Promise<void> {}
  async dequeue(): Promise<QueueItem<NoteIndexJob>[]> {
    return [];
  }
  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
  async peek(): Promise<number> {
    return 0;
  }
}

const chat: IChatPort = {
  async *complete() {
    yield '';
  },
};

function embedPort(): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(dim).fill(0.3));
    },
  };
}

function leafNode(id: string, noteId: string): DocumentNode {
  return {
    id,
    noteId,
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'hello',
    contentHash: 'hc',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('SqliteDocumentStore filters integration (RET-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('B1_single_glob_sqlite', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    try {
      await runB1SingleGlobContract(store);
    } finally {
      db.close();
    }
  });

  it('B2_union_globs_sqlite', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    try {
      await runB2UnionGlobsContract(store);
    } finally {
      db.close();
    }
  });

  it('B3_dateRange_inclusive_sqlite', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    try {
      await runB3DateRangeInclusiveContract(store);
    } finally {
      db.close();
    }
  });

  it('B4_null_note_date_excluded_sqlite', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    try {
      await runB4NullNoteDateExcludedContract(store);
    } finally {
      db.close();
    }
  });

  it('B5_intersection_sqlite', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    try {
      await runB5IntersectionContract(store);
    } finally {
      db.close();
    }
  });

  it('B6_note_date_round_trip_sqlite', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    try {
      await runB6NoteDateRoundTripContract(store);
    } finally {
      db.close();
    }
  });

  it('Y3_filters_pushed_down_all_paths', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    const summaryFilters: (NodeFilter | undefined)[] = [];
    const contentFilters: (NodeFilter | undefined)[] = [];
    const proxied = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'searchSummaryVectors') {
          return async (q: Float32Array, k: number, f?: NodeFilter) => {
            summaryFilters.push(f);
            return target.searchSummaryVectors(q, k, f);
          };
        }
        if (prop === 'searchContentVectors') {
          return async (q: Float32Array, k: number, f?: NodeFilter) => {
            contentFilters.push(f);
            return target.searchContentVectors(q, k, f);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as SqliteDocumentStore;

    const qv = new Float32Array(dim).fill(0.31);
    await proxied.upsertNodes([leafNode('s1', 'ns1')]);
    await proxied.upsertNoteMeta({
      noteId: 'ns1',
      vaultPath: 'Daily/x.md',
      contentHash: 'hx',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 1,
      noteDate: '2026-02-10',
    });
    await proxied.upsertEmbedding('s1', 'summary', qv, {
      model: 'm',
      dimension: dim,
      contentHash: 'c',
    });
    await proxied.upsertEmbedding('s1', 'content', qv, {
      model: 'm',
      dimension: dim,
      contentHash: 'c',
    });

    await runSearch(
      { store: proxied, embedder: embedPort() },
      {
        query: 'hello',
        coarseK: 32,
        enableHybridSearch: false,
        pathGlobs: ['Daily/**/*.md'],
        dateRange: { start: '2026-02-01', end: '2026-02-28' },
      },
      DEFAULT_SEARCH_ASSEMBLY,
    );

    expect(summaryFilters[0]?.pathRegex).toBeDefined();
    expect(summaryFilters[0]?.dateRange).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    const fallback = contentFilters.find((f) => !f?.subtreeRootNodeIds?.length);
    expect(fallback?.pathRegex).toBe(summaryFilters[0]?.pathRegex);
    expect(fallback?.dateRange).toEqual(summaryFilters[0]?.dateRange);
  });

  it('Y5_note_date_populated_by_indexing', async () => {
    const db = openRet6Db();
    const store = new SqliteDocumentStore(db);
    vi.spyOn(chunker, 'chunkNote').mockReturnValue({
      nodes: [leafNode('jn', 'Daily/2026-02-14.md')],
      crossRefs: [],
      tags: [],
    });
    vi.spyOn(summaryWorkflow, 'summarizeNote').mockResolvedValue(undefined);

    const item: QueueItem<NoteIndexJob> = {
      id: 'job-y5',
      payload: {
        runId: 'r-y5',
        noteId: 'Daily/2026-02-14.md',
        vaultPath: 'Daily/2026-02-14.md',
        noteTitle: '2026-02-14',
        markdown: '# x',
        contentHash: 'chy5',
        dailyNotePathGlobs: ['Daily/**/*.md'],
        dailyNoteDatePattern: 'YYYY-MM-DD',
      },
    };

    const deps: IndexWorkflowDeps = {
      store,
      queue: new QueueStub(),
      embed: embedPort(),
      chat,
      jobSteps: new JobStepsStub(),
      embeddingModel: 'emb',
      embeddingDimension: dim,
      chatModelLabel: 'chat',
    };

    try {
      await processOneJob(deps, {}, item);
      const meta = await store.getNoteMeta('Daily/2026-02-14.md');
      expect(meta?.noteDate).toBe('2026-02-14');
    } finally {
      db.close();
    }
  });
});
