import type { IndexProgressStatus, IndexStep, JobStep } from '../../core/domain/types.js';
import type { IProgressPort } from '../../core/ports/IProgressPort.js';
import Database from 'better-sqlite3';

type SqliteDatabase = InstanceType<typeof Database>;

export interface JobStepServiceOptions {
  db: SqliteDatabase;
  progress: IProgressPort;
  maxRetries?: number;
}

/**
 * Progress emission mapping (QUE-2 Y4):
 * - ensureJob: `queued` + started (job row created).
 * - transitionStep: previous step completed, new step started (unless no-op).
 * - markFailed: `failed` + failed.
 * - retry cap → `dead_letter` + failed (terminal).
 */
const FORWARD: Partial<Record<IndexStep, IndexStep[]>> = {
  queued: ['parsing'],
  parsing: ['parsed', 'failed'],
  parsed: ['storing', 'failed'],
  storing: ['stored', 'failed'],
  stored: ['summarizing', 'failed'],
  summarizing: ['summarized', 'failed'],
  summarized: ['embedding', 'failed'],
  embedding: ['embedded', 'failed'],
};

export class JobStepService {
  private readonly db: SqliteDatabase;
  private readonly progress: IProgressPort;
  private readonly maxRetries: number;

  constructor(options: JobStepServiceOptions) {
    this.db = options.db;
    this.progress = options.progress;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private emit(input: {
    jobId: string;
    runId: string;
    notePath: string;
    step: IndexStep;
    status: IndexProgressStatus;
    detail?: string;
  }): void {
    this.progress.emit({
      jobId: input.jobId,
      runId: input.runId,
      notePath: input.notePath,
      step: input.step,
      status: input.status,
      detail: input.detail,
    });
  }

  private rowToJobStep(row: Record<string, unknown>): JobStep {
    return {
      jobId: row.job_id as string,
      notePath: row.note_path as string,
      currentStep: row.current_step as IndexStep,
      contentHash: row.content_hash as string,
      retryCount: row.retry_count as number,
      errorMessage: (row.error_message as string | null) ?? null,
      updatedAt: row.updated_at as string,
    };
  }

  ensureJob(input: { jobId: string; runId: string; notePath: string; contentHash: string }): void {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO job_steps (job_id, note_path, current_step, content_hash, retry_count, error_message, updated_at)
         VALUES (?, ?, 'queued', ?, 0, NULL, datetime('now'))`,
      )
      .run(input.jobId, input.notePath, input.contentHash);
    if (res.changes > 0) {
      this.emit({
        jobId: input.jobId,
        runId: input.runId,
        notePath: input.notePath,
        step: 'queued',
        status: 'started',
      });
    }
  }

  transitionStep(input: { jobId: string; runId: string; to: IndexStep; detail?: string }): void {
    const row = this.db.prepare('SELECT * FROM job_steps WHERE job_id = ?').get(input.jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new Error(`transitionStep: unknown job ${input.jobId}`);
    }
    const from = row.current_step as IndexStep;
    const notePath = row.note_path as string;
    if (from === input.to) {
      return;
    }
    if (from === 'embedded' || from === 'dead_letter') {
      throw new Error(`transitionStep: terminal state ${from} cannot transition to ${input.to}`);
    }

    if (from === 'failed' && input.to === 'queued') {
      const retryCount = (row.retry_count as number) + 1;
      if (retryCount > this.maxRetries) {
        this.db
          .prepare(
            `UPDATE job_steps SET current_step = 'dead_letter', retry_count = ?, error_message = COALESCE(error_message, 'max retries'), updated_at = datetime('now') WHERE job_id = ?`,
          )
          .run(retryCount, input.jobId);
        this.emit({
          jobId: input.jobId,
          runId: input.runId,
          notePath,
          step: 'dead_letter',
          status: 'failed',
          detail: input.detail,
        });
        return;
      }
      this.db
        .prepare(
          `UPDATE job_steps SET current_step = 'queued', retry_count = ?, error_message = NULL, updated_at = datetime('now') WHERE job_id = ?`,
        )
        .run(retryCount, input.jobId);
      this.emit({
        jobId: input.jobId,
        runId: input.runId,
        notePath,
        step: 'failed',
        status: 'completed',
      });
      this.emit({
        jobId: input.jobId,
        runId: input.runId,
        notePath,
        step: 'queued',
        status: 'started',
        detail: input.detail,
      });
      return;
    }

    const allowed = FORWARD[from];
    if (!allowed?.includes(input.to)) {
      throw new Error(`transitionStep: illegal ${from} → ${input.to}`);
    }

    this.db
      .prepare(
        `UPDATE job_steps SET current_step = ?, updated_at = datetime('now') WHERE job_id = ?`,
      )
      .run(input.to, input.jobId);

    this.emit({
      jobId: input.jobId,
      runId: input.runId,
      notePath,
      step: from,
      status: 'completed',
    });
    if (input.to === 'failed') {
      this.emit({
        jobId: input.jobId,
        runId: input.runId,
        notePath,
        step: 'failed',
        status: 'failed',
        detail: input.detail,
      });
    } else {
      this.emit({
        jobId: input.jobId,
        runId: input.runId,
        notePath,
        step: input.to,
        status: 'started',
        detail: input.detail,
      });
    }
  }

  markFailed(input: { jobId: string; runId: string; message: string }): void {
    const row = this.db.prepare('SELECT * FROM job_steps WHERE job_id = ?').get(input.jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new Error(`markFailed: unknown job ${input.jobId}`);
    }
    const notePath = row.note_path as string;
    this.db
      .prepare(
        `UPDATE job_steps SET current_step = 'failed', error_message = ?, updated_at = datetime('now') WHERE job_id = ?`,
      )
      .run(input.message, input.jobId);
    this.emit({
      jobId: input.jobId,
      runId: input.runId,
      notePath,
      step: 'failed',
      status: 'failed',
      detail: input.message,
    });
  }

  listRecoverableJobs(): JobStep[] {
    const rows = this.db
      .prepare(`SELECT * FROM job_steps WHERE current_step NOT IN ('embedded', 'dead_letter')`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToJobStep(r));
  }
}
