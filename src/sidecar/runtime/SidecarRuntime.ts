import { randomUUID } from 'node:crypto';
import type {
  ChatStreamChunk,
  IndexStatusResponse,
  NoteIndexJob,
  SidecarRequest,
  SidecarResponse,
} from '../../core/domain/types.js';
import { planAndApplyIncrementalIndex } from '../../core/workflows/IncrementalIndexPlanner.js';
import type { IndexWorkflowDeps } from '../../core/workflows/IndexWorkflow.js';
import { processOneJob } from '../../core/workflows/IndexWorkflow.js';
import { runChatStream, type ChatWorkflowResult } from '../../core/workflows/ChatWorkflow.js';
import { runSearch } from '../../core/workflows/SearchWorkflow.js';
import { openDatabase } from '../db/open.js';
import { createChatPort } from '../adapters/createChatPort.js';
import { createEmbeddingPort } from '../adapters/createEmbeddingPort.js';
import { InProcessQueue } from '../adapters/InProcessQueue.js';
import { JobStepService } from '../adapters/JobStepService.js';
import { ProgressAdapter } from '../adapters/ProgressAdapter.js';
import { SqliteDocumentStore } from '../adapters/SqliteDocumentStore.js';
import type { Logger } from 'pino';

type SqliteDb = ReturnType<typeof openDatabase>;

const QUEUE_NAME = 'index';

function parseProvider(
  raw: string | undefined,
  fallback: 'openai' | 'ollama',
): 'openai' | 'ollama' {
  const v = raw?.trim().toLowerCase();
  return v === 'ollama' ? 'ollama' : fallback;
}

function parsePositiveInt(raw: string | undefined, def: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export interface SidecarRuntimeOptions {
  log: Logger;
  progress: ProgressAdapter;
}

/**
 * Lazy SQLite + queue + workflows (SRV-1, SRV-3). Handlers call {@link ensureDb} before storage.
 */
export class SidecarRuntime {
  private readonly log: Logger;
  private readonly progress: ProgressAdapter;
  private readonly started = Date.now();
  private db: SqliteDb | null = null;
  private store: SqliteDocumentStore | null = null;
  private queue: InProcessQueue<NoteIndexJob> | null = null;
  private jobSteps: JobStepService | null = null;

  constructor(options: SidecarRuntimeOptions) {
    this.log = options.log;
    this.progress = options.progress;
  }

  /** True after {@link ensureDb} succeeds. */
  isDbReady(): boolean {
    return this.db !== null;
  }

  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.started) / 1000);
  }

  getHealth(): import('../../core/domain/types.js').HealthResponse {
    return {
      status: 'ok',
      uptime: this.getUptimeSeconds(),
      dbReady: this.isDbReady(),
    };
  }

  ensureDb(): void {
    if (this.db) return;
    const path = process.env.OBSIDIAN_AI_DB_PATH?.trim();
    if (!path) {
      throw new Error('OBSIDIAN_AI_DB_PATH is not set');
    }
    const dim = parsePositiveInt(process.env.OBSIDIAN_AI_EMBEDDING_DIMENSION, 1536);
    this.log.info({ dbPath: path, embeddingDimension: dim }, 'sidecar.db.open');
    this.db = openDatabase(path, { embeddingDimension: dim });
    this.store = new SqliteDocumentStore(this.db);
    const maxRetries = parsePositiveInt(process.env.OBSIDIAN_AI_MAX_RETRIES, 3);
    const queueConcurrency = parsePositiveInt(process.env.OBSIDIAN_AI_QUEUE_CONCURRENCY, 1);
    this.jobSteps = new JobStepService({
      db: this.db,
      progress: this.progress,
      maxRetries,
    });
    this.queue = new InProcessQueue<NoteIndexJob>({
      db: this.db,
      queueName: QUEUE_NAME,
      maxRetries,
      queueConcurrency,
    });
  }

  private getIndexDeps(): IndexWorkflowDeps {
    this.ensureDb();
    const embedKind = parseProvider(process.env.OBSIDIAN_AI_EMBEDDING_PROVIDER, 'openai');
    const chatKind = parseProvider(process.env.OBSIDIAN_AI_CHAT_PROVIDER, 'openai');
    const embed = createEmbeddingPort(embedKind, {
      baseUrl: process.env.OBSIDIAN_AI_EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.OBSIDIAN_AI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    });
    const chat = createChatPort(chatKind, {
      baseUrl: process.env.OBSIDIAN_AI_CHAT_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.OBSIDIAN_AI_CHAT_MODEL ?? 'gpt-4o-mini',
    });
    return {
      queue: this.queue!,
      store: this.store!,
      embed,
      chat,
      jobSteps: this.jobSteps!,
      embeddingModel: process.env.OBSIDIAN_AI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      embeddingDimension: parsePositiveInt(process.env.OBSIDIAN_AI_EMBEDDING_DIMENSION, 1536),
      chatModelLabel: process.env.OBSIDIAN_AI_CHAT_MODEL ?? 'gpt-4o-mini',
    };
  }

  private getSearchDeps() {
    this.ensureDb();
    const embedKind = parseProvider(process.env.OBSIDIAN_AI_EMBEDDING_PROVIDER, 'openai');
    const embed = createEmbeddingPort(embedKind, {
      baseUrl: process.env.OBSIDIAN_AI_EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.OBSIDIAN_AI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    });
    return { store: this.store!, embedder: embed, log: this.log };
  }

  private getChatWorkflowDeps() {
    const search = this.getSearchDeps();
    const chatKind = parseProvider(process.env.OBSIDIAN_AI_CHAT_PROVIDER, 'openai');
    const chat = createChatPort(chatKind, {
      baseUrl: process.env.OBSIDIAN_AI_CHAT_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.OBSIDIAN_AI_CHAT_MODEL ?? 'gpt-4o-mini',
    });
    return { ...search, chat };
  }

  async drainIndexQueue(apiKey?: string): Promise<void> {
    const deps = this.getIndexDeps();
    const q = this.queue!;
    for (;;) {
      const pending = await q.peek();
      const proc = q.countProcessing();
      if (pending === 0 && proc === 0) return;
      const items = await q.dequeue(8);
      if (items.length === 0) {
        await new Promise((r) => setTimeout(r, 15));
        continue;
      }
      for (const it of items) {
        await processOneJob(deps, { apiKey }, it);
      }
    }
  }

  startIndexDrain(apiKey?: string): void {
    void this.drainIndexQueue(apiKey).catch((e) => {
      this.log.error({ err: e }, 'sidecar.index.drain_failed');
    });
  }

  getIndexStatus(): IndexStatusResponse {
    this.ensureDb();
    const db = this.db!;
    const qn = QUEUE_NAME;
    const row = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter
         FROM queue_items WHERE queue_name = ?`,
      )
      .get(qn) as Record<string, number | null>;
    const failedJobs = (
      db.prepare(`SELECT COUNT(*) as c FROM job_steps WHERE current_step = 'failed'`).get() as {
        c: number;
      }
    ).c;
    const deadJobs = (
      db
        .prepare(`SELECT COUNT(*) as c FROM job_steps WHERE current_step = 'dead_letter'`)
        .get() as { c: number }
    ).c;
    return {
      pending: row.pending ?? 0,
      processing: row.processing ?? 0,
      completed: row.completed ?? 0,
      failed: failedJobs,
      deadLetter: (row.dead_letter ?? 0) + deadJobs,
      jobs: this.jobSteps!.listJobSteps(),
    };
  }

  async handleSend(req: Exclude<SidecarRequest, { type: 'chat' }>): Promise<SidecarResponse> {
    const t0 = Date.now();
    switch (req.type) {
      case 'health':
        return { type: 'health', body: this.getHealth() };
      case 'index/full': {
        this.ensureDb();
        const runId = randomUUID();
        const r = await planAndApplyIncrementalIndex(
          { store: this.store!, queue: this.queue!, jobSteps: this.jobSteps! },
          {
            runId,
            files: req.payload.files,
            deletedPaths: [],
            forceReindex: true,
            dailyNotePathGlobs: req.payload.dailyNotePathGlobs,
            dailyNoteDatePattern: req.payload.dailyNoteDatePattern,
          },
        );
        this.log.info(
          { op: 'index/full', runId, enqueued: r.enqueued, ms: Date.now() - t0 },
          'sidecar.index.full',
        );
        this.startIndexDrain(req.payload.apiKey);
        return {
          type: 'index/full',
          body: {
            runId,
            scannedCount: req.payload.files.length,
            noteCount: r.enqueued,
            enqueuedCount: r.enqueued,
            skippedCount: r.skipped,
            deletedCount: r.deleted,
          },
        };
      }
      case 'index/incremental': {
        this.ensureDb();
        const runId = randomUUID();
        const r = await planAndApplyIncrementalIndex(
          { store: this.store!, queue: this.queue!, jobSteps: this.jobSteps! },
          {
            runId,
            files: req.payload.files,
            deletedPaths: req.payload.deletedPaths,
            dailyNotePathGlobs: req.payload.dailyNotePathGlobs,
            dailyNoteDatePattern: req.payload.dailyNoteDatePattern,
          },
        );
        this.log.info(
          { op: 'index/incremental', runId, enqueued: r.enqueued, ms: Date.now() - t0 },
          'sidecar.index.incremental',
        );
        this.startIndexDrain(req.payload.apiKey);
        return {
          type: 'index/incremental',
          body: {
            runId,
            scannedCount: req.payload.files.length,
            noteCount: r.enqueued,
            enqueuedCount: r.enqueued,
            skippedCount: r.skipped,
            deletedCount: r.deleted,
          },
        };
      }
      case 'index/status': {
        const body = this.getIndexStatus();
        return { type: 'index/status', body };
      }
      case 'search': {
        this.ensureDb();
        this.log.debug(
          {
            path_globs_count: req.payload.pathGlobs?.length ?? 0,
            date_range_start: req.payload.dateRange?.start,
            date_range_end: req.payload.dateRange?.end,
          },
          'sidecar.search.filters',
        );
        const body = await runSearch(this.getSearchDeps(), req.payload);
        this.log.info(
          { op: 'search', ms: Date.now() - t0, n: body.results.length },
          'sidecar.search',
        );
        return { type: 'search', body };
      }
      case 'chat/clear':
        return { type: 'chat/clear', body: { ok: true } };
      default:
        throw new Error(`unsupported sidecar operation: ${(req as { type: string }).type}`);
    }
  }

  async *handleChatStream(
    payload: Extract<SidecarRequest, { type: 'chat' }>['payload'],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<ChatStreamChunk, ChatWorkflowResult> {
    const t0 = Date.now();
    this.ensureDb();
    this.log.debug(
      {
        path_globs_count: payload.pathGlobs?.length ?? 0,
        date_range_start: payload.dateRange?.start,
        date_range_end: payload.dateRange?.end,
      },
      'sidecar.chat.filters',
    );
    const deps = this.getChatWorkflowDeps();
    const stream = runChatStream(deps, payload.messages, {
      search: payload.search,
      apiKey: payload.apiKey,
      k: payload.k,
      coarseK: payload.coarseK,
      enableHybridSearch: payload.enableHybridSearch,
      pathGlobs: payload.pathGlobs,
      dateRange: payload.dateRange,
      tags: undefined,
      completion: {
        signal: options?.signal,
        timeoutMs: payload.timeoutMs,
      },
    });
    let out: IteratorResult<string, ChatWorkflowResult>;
    while (!(out = await stream.next()).done) {
      yield { type: 'delta', delta: out.value };
    }
    this.log.info({ op: 'chat', ms: Date.now() - t0 }, 'sidecar.chat.done');
    return out.value;
  }
}
