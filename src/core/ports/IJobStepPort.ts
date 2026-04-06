import type { IndexStep, JobStep } from '../domain/types.js';

/**
 * Durable per-note indexing steps (ADR-008). Sidecar `JobStepService` implements this contract.
 */
export interface IJobStepPort {
  ensureJob(input: {
    jobId: string;
    runId: string;
    notePath: string;
    contentHash: string;
  }): void;

  transitionStep(input: {
    jobId: string;
    runId: string;
    to: IndexStep;
    detail?: string;
  }): void;

  markFailed(input: { jobId: string; runId: string; message: string }): void;

  listRecoverableJobs(): JobStep[];

  /** All rows in `job_steps` (for sidecar `index/status`). */
  listJobSteps(): JobStep[];

  /** Remove `job_steps` row when the note file was deleted from the vault (ADR-008 §6). */
  deleteJobForNotePath(notePath: string): void;
}
