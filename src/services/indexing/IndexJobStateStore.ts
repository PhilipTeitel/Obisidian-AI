import type { JobSnapshot, PersistedIndexJobState, RuntimeBootstrapContext } from "../../types";

const INDEX_JOB_STATE_STORAGE_KEY = "indexJobState";
const DEFAULT_HISTORY_LIMIT = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isValidJobProgress = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.completed === "number" &&
    Number.isFinite(value.completed) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    typeof value.label === "string"
  );
};

const isValidJobSnapshot = (value: unknown): value is JobSnapshot => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.status === "string" &&
    typeof value.startedAt === "number" &&
    Number.isFinite(value.startedAt) &&
    isValidJobProgress(value.progress)
  );
};

const createEmptyState = (): PersistedIndexJobState => {
  return {
    activeJob: null,
    lastCompletedJob: null,
    history: []
  };
};

const normalizeState = (state: PersistedIndexJobState, historyLimit: number): PersistedIndexJobState => {
  return {
    activeJob: state.activeJob,
    lastCompletedJob: state.lastCompletedJob,
    history: [...state.history].slice(0, historyLimit)
  };
};

export interface IndexJobStateStoreDeps {
  plugin: RuntimeBootstrapContext["plugin"];
  historyLimit?: number;
}

export class IndexJobStateStore {
  private readonly plugin: RuntimeBootstrapContext["plugin"];
  private readonly historyLimit: number;

  public constructor(deps: IndexJobStateStoreDeps) {
    this.plugin = deps.plugin;
    this.historyLimit = deps.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  public async load(): Promise<PersistedIndexJobState> {
    const rawData = await this.plugin.loadData();
    if (!isRecord(rawData)) {
      return createEmptyState();
    }

    const rawState = rawData[INDEX_JOB_STATE_STORAGE_KEY];
    if (!isRecord(rawState)) {
      return createEmptyState();
    }

    const activeJob = isValidJobSnapshot(rawState.activeJob) ? rawState.activeJob : null;
    const lastCompletedJob = isValidJobSnapshot(rawState.lastCompletedJob) ? rawState.lastCompletedJob : null;
    const history = Array.isArray(rawState.history) ? rawState.history.filter(isValidJobSnapshot) : [];
    return normalizeState(
      {
        activeJob,
        lastCompletedJob,
        history
      },
      this.historyLimit
    );
  }

  public async save(state: PersistedIndexJobState): Promise<void> {
    const rawData = await this.plugin.loadData();
    const persistedRoot = isRecord(rawData) ? { ...rawData } : {};
    persistedRoot[INDEX_JOB_STATE_STORAGE_KEY] = normalizeState(state, this.historyLimit);
    await this.plugin.saveData(persistedRoot);
  }

  public async getActiveJob(): Promise<JobSnapshot | null> {
    const state = await this.load();
    return state.activeJob;
  }

  public async markActiveJob(snapshot: JobSnapshot): Promise<void> {
    const state = await this.load();
    await this.save({
      ...state,
      activeJob: snapshot
    });
  }

  public async markJobCompleted(snapshot: JobSnapshot): Promise<void> {
    const state = await this.load();
    await this.save({
      activeJob: null,
      lastCompletedJob: snapshot,
      history: [snapshot, ...state.history]
    });
  }

  public async reconcileStaleActiveJob(now = Date.now()): Promise<JobSnapshot | null> {
    const state = await this.load();
    if (!state.activeJob) {
      return null;
    }

    const staleJob = state.activeJob;
    const recoveredSnapshot: JobSnapshot = {
      ...staleJob,
      status: "failed",
      finishedAt: now,
      progress: {
        ...staleJob.progress,
        detail: "Recovered stale active indexing state from a previous interrupted run."
      },
      errorMessage: staleJob.errorMessage ?? "Recovered stale active indexing state."
    };

    await this.save({
      activeJob: null,
      lastCompletedJob: recoveredSnapshot,
      history: [recoveredSnapshot, ...state.history]
    });

    return recoveredSnapshot;
  }
}
