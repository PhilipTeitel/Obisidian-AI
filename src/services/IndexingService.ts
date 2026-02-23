import type {
  EmbeddingServiceContract,
  ChunkRecord,
  ChunkerInput,
  IncrementalDiffResult,
  IndexConsistencyReport,
  IndexedNoteFingerprint,
  IndexingRunOptions,
  IndexingServiceContract,
  JobSnapshot,
  JobStatus,
  JobType,
  RuntimeBootstrapContext
} from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import type { IndexJobStateStore } from "./indexing/IndexJobStateStore";
import type { IndexManifestStore } from "./indexing/IndexManifestStore";
import { applyRecoveryActions, runConsistencyPreflight } from "./indexing/indexConsistency";
import { chunkMarkdownNote } from "../utils/chunker";
import { hashNormalizedMarkdown } from "../utils/hasher";
import { crawlVaultMarkdownNotes } from "../utils/vaultCrawler";

export interface IndexingServiceDeps {
  app: RuntimeBootstrapContext["app"];
  embeddingService: EmbeddingServiceContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
  manifestStore: IndexManifestStore;
  jobStateStore: IndexJobStateStore;
}

const createSnapshot = (params: {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: number;
  completed: number;
  total: number;
  label: string;
  detail: string;
  errorMessage?: string;
}): JobSnapshot => {
  const isFinished = params.status === "succeeded" || params.status === "failed" || params.status === "cancelled";
  return {
    id: params.id,
    type: params.type,
    status: params.status,
    startedAt: params.startedAt,
    finishedAt: isFinished ? Date.now() : undefined,
    progress: {
      completed: params.completed,
      total: params.total,
      label: params.label,
      detail: params.detail
    },
    errorMessage: params.errorMessage
  };
};

const createJobId = (jobType: JobType, startedAt: number): string => {
  return `${jobType}:${startedAt}`;
};

const buildFingerprints = (notes: ChunkerInput[]): IndexedNoteFingerprint[] => {
  return [...notes]
    .map((note) => ({
      notePath: note.notePath,
      noteHash: hashNormalizedMarkdown(note.markdown),
      updatedAt: note.updatedAt
    }))
    .sort((left, right) => left.notePath.localeCompare(right.notePath));
};

const appendRecoveryDetail = (detail: string, recoveryMessages: string[]): string => {
  if (recoveryMessages.length === 0) {
    return detail;
  }
  return `${detail} Recovery: ${recoveryMessages.join(" ")}`;
};

export const computeIncrementalDiff = (
  previous: IndexedNoteFingerprint[],
  current: IndexedNoteFingerprint[]
): IncrementalDiffResult => {
  const previousByPath = new Map(previous.map((entry) => [entry.notePath, entry]));
  const currentByPath = new Map(current.map((entry) => [entry.notePath, entry]));

  const created: IndexedNoteFingerprint[] = [];
  const updated: IndexedNoteFingerprint[] = [];
  const unchanged: IndexedNoteFingerprint[] = [];
  const deleted: IndexedNoteFingerprint[] = [];

  for (const currentEntry of current) {
    const previousEntry = previousByPath.get(currentEntry.notePath);
    if (!previousEntry) {
      created.push(currentEntry);
      continue;
    }
    if (previousEntry.noteHash !== currentEntry.noteHash) {
      updated.push(currentEntry);
      continue;
    }
    unchanged.push(currentEntry);
  }

  for (const previousEntry of previous) {
    if (!currentByPath.has(previousEntry.notePath)) {
      deleted.push(previousEntry);
    }
  }

  return {
    created,
    updated,
    unchanged,
    deleted
  };
};

export class IndexingService implements IndexingServiceContract {
  private disposed = false;
  private readonly deps: IndexingServiceDeps;
  private activeJob: JobSnapshot | null = null;
  private readonly logger = createRuntimeLogger("IndexingService");

  public constructor(deps: IndexingServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.activeJob = null;
  }

  public getActiveJob(): JobSnapshot | null {
    return this.activeJob;
  }

  public async reindexVault(options: IndexingRunOptions = {}): Promise<JobSnapshot> {
    return this.runIndexingJob({
      commandLabel: "Reindex vault",
      jobType: "reindex-vault",
      mode: "full",
      options
    });
  }

  public async indexChanges(options: IndexingRunOptions = {}): Promise<JobSnapshot> {
    return this.runIndexingJob({
      commandLabel: "Index changes",
      jobType: "index-changes",
      mode: "incremental",
      options
    });
  }

  private chunkNoteForIndexing(input: ChunkerInput): ChunkRecord[] {
    return chunkMarkdownNote(input);
  }

  private async crawlNotesForIndexing(): Promise<ChunkerInput[]> {
    const settings = this.deps.getSettings();
    return crawlVaultMarkdownNotes({
      vault: this.deps.app.vault,
      indexedFolders: settings.indexedFolders,
      excludedFolders: settings.excludedFolders
    });
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("IndexingService is disposed.");
    }
  }

  private ensureNoActiveJob(): void {
    if (this.activeJob) {
      throw new Error("An indexing job is already running. Wait for it to finish before starting another command.");
    }
  }

  private async emitProgress(snapshot: JobSnapshot, options: IndexingRunOptions): Promise<void> {
    this.activeJob = snapshot.status === "running" ? snapshot : null;
    if (snapshot.status === "running") {
      await this.safeMarkActiveJob(snapshot);
    } else {
      await this.safeMarkCompletedJob(snapshot);
    }

    if (!options.onProgress) {
      return;
    }

    try {
      options.onProgress(snapshot);
    } catch (error: unknown) {
      this.logger.log({
        level: "warn",
        event: "indexing.progress.callback_failed",
        message: "Index progress callback failed and was ignored.",
        context: {
          operation: "IndexingService.emitProgress",
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async safeMarkActiveJob(snapshot: JobSnapshot): Promise<void> {
    try {
      await this.deps.jobStateStore.markActiveJob(snapshot);
    } catch (error: unknown) {
      this.logger.log({
        level: "warn",
        event: "indexing.job_state.active_write_failed",
        message: "Failed to persist active index job state; continuing without persistence.",
        context: {
          operation: "IndexingService.safeMarkActiveJob",
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async safeMarkCompletedJob(snapshot: JobSnapshot): Promise<void> {
    try {
      await this.deps.jobStateStore.markJobCompleted(snapshot);
    } catch (error: unknown) {
      this.logger.log({
        level: "warn",
        event: "indexing.job_state.terminal_write_failed",
        message: "Failed to persist terminal index job state; continuing without persistence.",
        context: {
          operation: "IndexingService.safeMarkCompletedJob",
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async runIndexingJob(params: {
    commandLabel: string;
    jobType: JobType;
    mode: "full" | "incremental";
    options: IndexingRunOptions;
  }): Promise<JobSnapshot> {
    this.ensureNotDisposed();
    this.ensureNoActiveJob();

    let consistencyReport: IndexConsistencyReport = {
      ok: true,
      issues: [],
      requiresFullReindexBaseline: false
    };
    let recoveryMessages: string[] = [];

    try {
      consistencyReport = await runConsistencyPreflight({
        manifestStore: this.deps.manifestStore,
        jobStateStore: this.deps.jobStateStore
      });
      const recoveryResult = await applyRecoveryActions(consistencyReport, {
        manifestStore: this.deps.manifestStore,
        jobStateStore: this.deps.jobStateStore
      });
      recoveryMessages = recoveryResult.recoveryMessages;
    } catch (error: unknown) {
      this.logger.log({
        level: "warn",
        event: "indexing.consistency.preflight_failed",
        message: "Consistency preflight failed; continuing with safe baseline fallback.",
        context: {
          operation: "IndexingService.runIndexingJob",
          error: error instanceof Error ? error.message : String(error)
        }
      });
      consistencyReport = {
        ok: false,
        issues: [
          {
            code: "MANIFEST_SHAPE_INVALID",
            message: "Consistency preflight failed and baseline reset is required.",
            recoverable: true
          }
        ],
        requiresFullReindexBaseline: true
      };
      recoveryMessages = ["Consistency preflight failed; fallback baseline indexing was used."];
    }

    const startedAt = Date.now();
    const jobId = createJobId(params.jobType, startedAt);

    const crawlSnapshot = createSnapshot({
      id: jobId,
      type: params.jobType,
      status: "running",
      startedAt,
      completed: 0,
      total: 0,
      label: `${params.commandLabel} · Crawl`,
      detail: "Scanning scoped markdown notes."
    });
    await this.emitProgress(crawlSnapshot, params.options);

    try {
      const noteInputs = await this.crawlNotesForIndexing();
      const shouldFallbackToBaseline =
        params.mode === "incremental" && consistencyReport.requiresFullReindexBaseline;

      const terminalSnapshot = shouldFallbackToBaseline
        ? await this.runBaselineFromIncremental({
            commandLabel: params.commandLabel,
            jobType: params.jobType,
            jobId,
            startedAt,
            noteInputs,
            options: params.options,
            recoveryMessages
          })
        : params.mode === "full"
          ? await this.runFullReindex({
              commandLabel: params.commandLabel,
              jobType: params.jobType,
              jobId,
              startedAt,
              noteInputs,
              options: params.options,
              recoveryMessages
            })
          : await this.runIncrementalIndex({
              commandLabel: params.commandLabel,
              jobType: params.jobType,
              jobId,
              startedAt,
              noteInputs,
              options: params.options,
              recoveryMessages
            });

      await this.emitProgress(terminalSnapshot, params.options);
      return terminalSnapshot;
    } catch (error: unknown) {
      const failedSnapshot = createSnapshot({
        id: jobId,
        type: params.jobType,
        status: "failed",
        startedAt,
        completed: 0,
        total: 0,
        label: params.commandLabel,
        detail: appendRecoveryDetail("Indexing command failed.", recoveryMessages),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      await this.emitProgress(failedSnapshot, params.options);
      throw error;
    }
  }

  private async runFullReindex(params: {
    commandLabel: string;
    jobType: JobType;
    jobId: string;
    startedAt: number;
    noteInputs: ChunkerInput[];
    options: IndexingRunOptions;
    recoveryMessages: string[];
  }): Promise<JobSnapshot> {
    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: params.noteInputs.length,
        label: `${params.commandLabel} · Chunk`,
        detail: `Chunking ${params.noteInputs.length} notes.`
      }),
      params.options
    );

    const chunks = params.noteInputs.flatMap((input) => this.chunkNoteForIndexing(input));

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: chunks.length,
        label: `${params.commandLabel} · Embed`,
        detail: `Embedding ${chunks.length} chunks.`
      }),
      params.options
    );

    await this.embedChunkContent(chunks);

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: params.noteInputs.length,
        total: params.noteInputs.length,
        label: `${params.commandLabel} · Finalize`,
        detail: "Persisting index baseline manifest."
      }),
      params.options
    );

    await this.deps.manifestStore.save({
      version: 1,
      updatedAt: Date.now(),
      notes: buildFingerprints(params.noteInputs)
    });

    const detail =
      params.noteInputs.length === 0
        ? "Indexed 0 notes into 0 chunks."
        : `Indexed ${params.noteInputs.length} notes into ${chunks.length} chunks.`;

    return createSnapshot({
      id: params.jobId,
      type: params.jobType,
      status: "succeeded",
      startedAt: params.startedAt,
      completed: params.noteInputs.length,
      total: params.noteInputs.length,
      label: params.commandLabel,
      detail: appendRecoveryDetail(detail, params.recoveryMessages)
    });
  }

  private async runBaselineFromIncremental(params: {
    commandLabel: string;
    jobType: JobType;
    jobId: string;
    startedAt: number;
    noteInputs: ChunkerInput[];
    options: IndexingRunOptions;
    recoveryMessages: string[];
  }): Promise<JobSnapshot> {
    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: params.noteInputs.length,
        label: `${params.commandLabel} · Chunk`,
        detail: "Manifest is unavailable; chunking full baseline."
      }),
      params.options
    );

    const chunks = params.noteInputs.flatMap((input) => this.chunkNoteForIndexing(input));

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: chunks.length,
        label: `${params.commandLabel} · Embed`,
        detail: `Embedding ${chunks.length} chunks for baseline fallback.`
      }),
      params.options
    );

    await this.embedChunkContent(chunks);

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: params.noteInputs.length,
        total: params.noteInputs.length,
        label: `${params.commandLabel} · Finalize`,
        detail: "Persisting recovered baseline manifest."
      }),
      params.options
    );

    await this.deps.manifestStore.save({
      version: 1,
      updatedAt: Date.now(),
      notes: buildFingerprints(params.noteInputs)
    });

    return createSnapshot({
      id: params.jobId,
      type: params.jobType,
      status: "succeeded",
      startedAt: params.startedAt,
      completed: params.noteInputs.length,
      total: params.noteInputs.length,
      label: params.commandLabel,
      detail: appendRecoveryDetail(
        `Fallback baseline run indexed ${params.noteInputs.length} notes into ${chunks.length} chunks.`,
        params.recoveryMessages
      )
    });
  }

  private async runIncrementalIndex(params: {
    commandLabel: string;
    jobType: JobType;
    jobId: string;
    startedAt: number;
    noteInputs: ChunkerInput[];
    options: IndexingRunOptions;
    recoveryMessages: string[];
  }): Promise<JobSnapshot> {
    const previousManifest = await this.deps.manifestStore.load();
    const currentFingerprints = buildFingerprints(params.noteInputs);
    const diff = computeIncrementalDiff(previousManifest.notes, currentFingerprints);
    const notesToReindex = this.selectChangedNotes(params.noteInputs, diff);

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: notesToReindex.length,
        label: `${params.commandLabel} · Chunk`,
        detail: `Chunking ${notesToReindex.length} changed notes.`
      }),
      params.options
    );

    const chunks = notesToReindex.flatMap((input) => this.chunkNoteForIndexing(input));

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: chunks.length,
        label: `${params.commandLabel} · Embed`,
        detail:
          chunks.length === 0
            ? "No changed chunks require embedding."
            : `Embedding ${chunks.length} chunks from changed notes.`
      }),
      params.options
    );

    await this.embedChunkContent(chunks);

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: currentFingerprints.length,
        total: currentFingerprints.length,
        label: `${params.commandLabel} · Finalize`,
        detail: "Persisting incremental manifest updates."
      }),
      params.options
    );

    await this.deps.manifestStore.save({
      version: 1,
      updatedAt: Date.now(),
      notes: currentFingerprints
    });

    const detail =
      diff.created.length === 0 && diff.updated.length === 0 && diff.deleted.length === 0
        ? "No changes detected. Created 0, updated 0, deleted 0."
        : `Created ${diff.created.length}, updated ${diff.updated.length}, deleted ${diff.deleted.length} notes; embedded ${chunks.length} chunks.`;

    return createSnapshot({
      id: params.jobId,
      type: params.jobType,
      status: "succeeded",
      startedAt: params.startedAt,
      completed: currentFingerprints.length,
      total: currentFingerprints.length,
      label: params.commandLabel,
      detail: appendRecoveryDetail(detail, params.recoveryMessages)
    });
  }

  private selectChangedNotes(
    noteInputs: ChunkerInput[],
    diff: IncrementalDiffResult
  ): ChunkerInput[] {
    const changedPaths = new Set<string>([
      ...diff.created.map((entry) => entry.notePath),
      ...diff.updated.map((entry) => entry.notePath)
    ]);
    return noteInputs.filter((note) => changedPaths.has(note.notePath));
  }

  private async embedChunkContent(chunks: ChunkRecord[]): Promise<void> {
    const settings = this.deps.getSettings();
    if (chunks.length === 0) {
      return;
    }
    await this.deps.embeddingService.embed({
      providerId: settings.embeddingProvider,
      model: settings.embeddingModel,
      inputs: chunks.map((chunk) => chunk.content)
    });
  }
}
