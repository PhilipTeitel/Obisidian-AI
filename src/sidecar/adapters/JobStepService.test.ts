import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '../../core/domain/types.js';
import type { IProgressPort } from '../../core/ports/IProgressPort.js';
import Database from 'better-sqlite3';
import { runRelationalMigrations } from '../db/migrate.js';
import { JobStepService } from './JobStepService.js';

class FakeProgress implements IProgressPort {
  readonly events: ProgressEvent[] = [];
  emit(event: ProgressEvent): void {
    this.events.push(event);
  }
}

function svc(maxRetries?: number): {
  db: InstanceType<typeof Database>;
  progress: FakeProgress;
  job: JobStepService;
} {
  const db = new Database(':memory:');
  runRelationalMigrations(db);
  const progress = new FakeProgress();
  const job = new JobStepService({ db, progress, maxRetries });
  return { db, progress, job };
}

describe('JobStepService', () => {
  it('A1_ensure_job', () => {
    const { db, progress, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'n.md',
      contentHash: 'h',
    });
    const row = db.prepare('SELECT * FROM job_steps WHERE job_id = ?').get('j1') as {
      current_step: string;
      content_hash: string;
      note_path: string;
    };
    expect(row.current_step).toBe('queued');
    expect(row.content_hash).toBe('h');
    expect(row.note_path).toBe('n.md');
    expect(progress.events.some((e) => e.step === 'queued')).toBe(true);
    db.close();
  });

  it('A2_valid_transitions', () => {
    const { db, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'n.md',
      contentHash: 'h',
    });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'parsing' });
    expect(() => job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'stored' })).toThrow();
    db.close();
  });

  it('A3_idempotent_repeat', () => {
    const { db, progress, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'n.md',
      contentHash: 'h',
    });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'parsing' });
    const afterFirst = progress.events.length;
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'parsing' });
    expect(progress.events.length).toBe(afterFirst);
    db.close();
  });

  it('B1_mark_failed', () => {
    const { db, progress, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'n.md',
      contentHash: 'h',
    });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'parsing' });
    progress.events.length = 0;
    job.markFailed({ jobId: 'j1', runId: 'r1', message: 'boom' });
    const row = db
      .prepare('SELECT current_step, error_message FROM job_steps WHERE job_id = ?')
      .get('j1') as { current_step: string; error_message: string };
    expect(row.current_step).toBe('failed');
    expect(row.error_message).toBe('boom');
    expect(progress.events.some((e) => e.step === 'failed' && e.status === 'failed')).toBe(true);
    db.close();
  });

  it('B2_retry_and_dead_letter', () => {
    const { db, job } = svc(2);
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'n.md',
      contentHash: 'h',
    });
    job.markFailed({ jobId: 'j1', runId: 'r1', message: 'a' });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'queued' });
    job.markFailed({ jobId: 'j1', runId: 'r1', message: 'b' });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'queued' });
    job.markFailed({ jobId: 'j1', runId: 'r1', message: 'c' });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'queued' });
    const row = db
      .prepare('SELECT current_step, retry_count FROM job_steps WHERE job_id = ?')
      .get('j1') as { current_step: string; retry_count: number };
    expect(row.current_step).toBe('dead_letter');
    expect(row.retry_count).toBe(3);
    db.close();
  });

  it('C1_recoverable_jobs', () => {
    const { db, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'a.md',
      contentHash: 'h',
    });
    job.ensureJob({
      jobId: 'j2',
      runId: 'r1',
      notePath: 'b.md',
      contentHash: 'h',
    });
    for (const step of [
      'parsing',
      'parsed',
      'storing',
      'stored',
      'summarizing',
      'summarized',
      'embedding',
      'embedded',
    ] as const) {
      job.transitionStep({ jobId: 'j2', runId: 'r1', to: step });
    }
    job.markFailed({ jobId: 'j1', runId: 'r1', message: 'x' });
    const list = job.listRecoverableJobs();
    expect(list.some((j) => j.jobId === 'j1')).toBe(true);
    expect(list.some((j) => j.jobId === 'j2')).toBe(false);
    db.close();
  });

  it('D1_progress_sequence', () => {
    const { db, progress, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'n.md',
      contentHash: 'h',
    });
    progress.events.length = 0;
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'parsing' });
    job.transitionStep({ jobId: 'j1', runId: 'r1', to: 'parsed' });
    expect(progress.events.length).toBeGreaterThanOrEqual(2);
    expect(progress.events.every((e) => e.jobId === 'j1')).toBe(true);
    expect(progress.events.every((e) => e.runId === 'r1')).toBe(true);
    expect(progress.events.every((e) => e.notePath === 'n.md')).toBe(true);
    db.close();
  });

  it('Y2_column_roundtrip', () => {
    const { db, job } = svc();
    job.ensureJob({
      jobId: 'j1',
      runId: 'r1',
      notePath: 'p.md',
      contentHash: 'ch',
    });
    const cols = db.prepare('PRAGMA table_info(job_steps)').all() as {
      name: string;
    }[];
    const names = new Set(cols.map((c) => c.name));
    for (const n of [
      'job_id',
      'note_path',
      'current_step',
      'content_hash',
      'retry_count',
      'error_message',
      'updated_at',
    ]) {
      expect(names.has(n)).toBe(true);
    }
    const [row] = job.listRecoverableJobs();
    expect(row.notePath).toBe('p.md');
    db.close();
  });
});
