import type { IndexConsistencyIssue, IndexConsistencyReport } from "../../types";
import type { IndexJobStateStore } from "./IndexJobStateStore";
import type { IndexManifestStore } from "./IndexManifestStore";

export interface IndexConsistencyDeps {
  manifestStore: IndexManifestStore;
  jobStateStore: IndexJobStateStore;
}

export interface RecoveryActionsResult {
  recoveryMessages: string[];
}

const hasIssueCode = (issues: IndexConsistencyIssue[], code: IndexConsistencyIssue["code"]): boolean => {
  return issues.some((issue) => issue.code === code);
};

export const runConsistencyPreflight = async (deps: IndexConsistencyDeps): Promise<IndexConsistencyReport> => {
  const issues: IndexConsistencyIssue[] = [];

  const manifestResult = await deps.manifestStore.loadWithIssues();
  issues.push(...manifestResult.issues);

  const activeJob = await deps.jobStateStore.getActiveJob();
  if (activeJob) {
    issues.push({
      code: "STALE_ACTIVE_JOB",
      message: "Recovered stale active indexing state from a previous interrupted run.",
      recoverable: true
    });
  }

  const requiresFullReindexBaseline = hasIssueCode(issues, "MANIFEST_SHAPE_INVALID") ||
    hasIssueCode(issues, "MANIFEST_VERSION_UNSUPPORTED");

  return {
    ok: issues.length === 0,
    issues,
    requiresFullReindexBaseline
  };
};

export const applyRecoveryActions = async (
  report: IndexConsistencyReport,
  deps: IndexConsistencyDeps
): Promise<RecoveryActionsResult> => {
  const recoveryMessages: string[] = [];

  if (hasIssueCode(report.issues, "STALE_ACTIVE_JOB")) {
    const reconciled = await deps.jobStateStore.reconcileStaleActiveJob();
    if (reconciled) {
      recoveryMessages.push("Recovered stale active indexing state from a previous run.");
    }
  }

  if (report.requiresFullReindexBaseline) {
    await deps.manifestStore.resetToBaseline();
    recoveryMessages.push("Reset invalid index manifest and re-seeded a safe baseline.");
  }

  return {
    recoveryMessages
  };
};
