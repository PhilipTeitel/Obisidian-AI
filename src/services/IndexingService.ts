import type {
  EmbeddingServiceContract,
  ChunkRecord,
  ChunkerInput,
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingType,
  EmbeddingVector,
  HierarchicalStoreContract,
  IncrementalDiffResult,
  IndexConsistencyReport,
  IndexedNoteFingerprint,
  IndexingRunOptions,
  IndexingServiceContract,
  JobSnapshot,
  JobStatus,
  JobType,
  RuntimeBootstrapContext,
  SummaryServiceContract,
  VectorStoreRepositoryContract
} from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import type { IndexJobStateStore } from "./indexing/IndexJobStateStore";
import type { IndexManifestStore } from "./indexing/IndexManifestStore";
import { applyRecoveryActions, runConsistencyPreflight } from "./indexing/indexConsistency";
import { buildDocumentTree, chunkMarkdownNote } from "../utils/chunker";
import type { HierarchicalChunkerResult } from "../utils/chunker";
import { hashNormalizedMarkdown } from "../utils/hasher";
import { crawlVaultMarkdownNotes } from "../utils/vaultCrawler";
import { EmbeddingBatchError } from "./errors/EmbeddingBatchError";

export interface IndexingServiceDeps {
  app: RuntimeBootstrapContext["app"];
  embeddingService: EmbeddingServiceContract;
  vectorStoreRepository: VectorStoreRepositoryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
  manifestStore: IndexManifestStore;
  jobStateStore: IndexJobStateStore;
  summaryService: SummaryServiceContract;
  hierarchicalStore: HierarchicalStoreContract;
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

const RETRYABLE_PROVIDER_FAILURE_PATTERN = /(timeout|timed out|fetch failed|network|econn|enotfound|429|503|rate.?limit)/i;
const STORAGE_FAILURE_PATTERN = /(storage|sqlite|disk|readonly|i\/o|filesystem|file|permission)/i;
const MAX_INDEXING_ATTEMPTS = 2;

const isRetryableProviderFailure = (message: string): boolean => {
  return RETRYABLE_PROVIDER_FAILURE_PATTERN.test(message);
};

const toRecoveryAction = (message: string, mode: "full" | "incremental"): string => {
  if (isRetryableProviderFailure(message)) {
    return mode === "incremental"
      ? "Check provider endpoint/API key and retry Index changes. If retries keep failing, run Reindex vault to rebuild a clean baseline."
      : "Check provider endpoint/API key and retry the indexing command.";
  }

  if (STORAGE_FAILURE_PATTERN.test(message)) {
    return "Check local storage permissions/capacity and rerun Reindex vault to recover consistency.";
  }

  return mode === "incremental"
    ? "Retry Index changes. If failures persist, run Reindex vault to recover consistency."
    : "Retry the indexing command and review runtime logs.";
};

const withRecoveryAction = (message: string, mode: "full" | "incremental"): string => {
  return `${message} Recovery action: ${toRecoveryAction(message, mode)}`;
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

      const runSelectedMode = async () => {
        return shouldFallbackToBaseline
          ? this.runBaselineFromIncremental({
              commandLabel: params.commandLabel,
              jobType: params.jobType,
              jobId,
              startedAt,
              noteInputs,
              options: params.options,
              recoveryMessages
            })
          : params.mode === "full"
            ? this.runFullReindex({
                commandLabel: params.commandLabel,
                jobType: params.jobType,
                jobId,
                startedAt,
                noteInputs,
                options: params.options,
                recoveryMessages
              })
            : this.runIncrementalIndex({
                commandLabel: params.commandLabel,
                jobType: params.jobType,
                jobId,
                startedAt,
                noteInputs,
                options: params.options,
                recoveryMessages
              });
      };

      let terminalSnapshot: JobSnapshot | null = null;
      let attempt = 1;
      while (attempt <= MAX_INDEXING_ATTEMPTS && terminalSnapshot === null) {
        try {
          terminalSnapshot = await runSelectedMode();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt >= MAX_INDEXING_ATTEMPTS || !isRetryableProviderFailure(message)) {
            throw error;
          }

          attempt += 1;
          await this.emitProgress(
            createSnapshot({
              id: jobId,
              type: params.jobType,
              status: "running",
              startedAt,
              completed: 0,
              total: 0,
              label: `${params.commandLabel} · Retry`,
              detail: `Transient provider failure detected; retrying indexing attempt ${attempt} of ${MAX_INDEXING_ATTEMPTS}.`
            }),
            params.options
          );
        }
      }
      if (!terminalSnapshot) {
        throw new Error("Indexing command failed before producing a terminal snapshot.");
      }

      await this.emitProgress(terminalSnapshot, params.options);
      return terminalSnapshot;
    } catch (error: unknown) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const errorMessageWithRecovery = withRecoveryAction(originalMessage, params.mode);
      const failedSnapshot = createSnapshot({
        id: jobId,
        type: params.jobType,
        status: "failed",
        startedAt,
        completed: 0,
        total: 0,
        label: params.commandLabel,
        detail: appendRecoveryDetail("Indexing command failed.", [...recoveryMessages, toRecoveryAction(originalMessage, params.mode)]),
        errorMessage: errorMessageWithRecovery
      });
      await this.emitProgress(failedSnapshot, params.options);
      throw new Error(errorMessageWithRecovery);
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

    const hierarchicalResults = params.noteInputs.map((input) => buildDocumentTree(input));

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: hierarchicalResults.length,
        label: `${params.commandLabel} · Store`,
        detail: `Storing ${hierarchicalResults.length} document trees.`
      }),
      params.options
    );

    await this.storeHierarchicalTrees(hierarchicalResults);

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: hierarchicalResults.length,
        label: `${params.commandLabel} · Summarize`,
        detail: `Generating summaries for ${hierarchicalResults.length} trees.`
      }),
      params.options
    );

    await this.generateTreeSummaries(hierarchicalResults);

    const embeddableNodes = await this.collectEmbeddableNodes(hierarchicalResults);

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: embeddableNodes.length,
        label: `${params.commandLabel} · Embed`,
        detail: `Embedding ${embeddableNodes.length} nodes and ${chunks.length} flat chunks.`
      }),
      params.options
    );

    const vectors = await this.embedChunkContent(chunks);
    await this.deps.vectorStoreRepository.replaceAllFromChunks(chunks, vectors);

    await this.embedHierarchicalNodes(embeddableNodes);

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

    const vectors = await this.embedChunkContent(chunks);
    await this.deps.vectorStoreRepository.replaceAllFromChunks(chunks, vectors);

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
    const notePathsToDelete = [...new Set([...diff.deleted.map((entry) => entry.notePath), ...notesToReindex.map((entry) => entry.notePath)])];
    const hasChanges = diff.created.length > 0 || diff.updated.length > 0 || diff.deleted.length > 0;
    const hasCreatedOrUpdated = diff.created.length > 0 || diff.updated.length > 0;

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

    // --- Hierarchical pipeline: collect existing node IDs, delete stale data, build trees ---
    const existingNodeIds: string[] = [];
    let hierarchicalResults: HierarchicalChunkerResult[] = [];

    if (hasChanges) {
      for (const notePath of diff.updated.map((e) => e.notePath)) {
        const existingNodes = await this.deps.hierarchicalStore.getNodesByNotePath(notePath);
        for (const node of existingNodes) {
          existingNodeIds.push(node.nodeId);
        }
      }

      for (const notePath of notePathsToDelete) {
        await this.deps.hierarchicalStore.deleteByNotePath(notePath);
      }

      if (hasCreatedOrUpdated) {
        hierarchicalResults = notesToReindex.map((input) => buildDocumentTree(input));
      }
    }

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: hierarchicalResults.length,
        label: `${params.commandLabel} · Store`,
        detail: hierarchicalResults.length === 0
          ? "No changed trees to store."
          : `Storing ${hierarchicalResults.length} document trees.`
      }),
      params.options
    );

    if (hierarchicalResults.length > 0) {
      await this.storeHierarchicalTrees(hierarchicalResults);
    }

    // --- Hierarchical pipeline: incremental summary propagation ---
    const newNodeIds: string[] = [];
    for (const result of hierarchicalResults) {
      for (const node of result.tree.nodes.values()) {
        newNodeIds.push(node.nodeId);
      }
    }
    const changedNodeIds = [...existingNodeIds, ...newNodeIds];

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: changedNodeIds.length,
        label: `${params.commandLabel} · Summarize`,
        detail: changedNodeIds.length === 0
          ? "No changed nodes require summary propagation."
          : `Propagating summaries for ${changedNodeIds.length} changed nodes.`
      }),
      params.options
    );

    if (changedNodeIds.length > 0) {
      try {
        await this.deps.summaryService.propagateSummariesForChangedNodes(changedNodeIds);
      } catch (error: unknown) {
        this.logger.log({
          level: "warn",
          event: "indexing.incremental.summary_propagation_failed",
          message: "Incremental summary propagation failed; continuing with embedding.",
          context: {
            operation: "IndexingService.runIncrementalIndex",
            changedNodeCount: changedNodeIds.length,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }

    // --- Hierarchical pipeline: embed changed nodes ---
    const embeddableNodes = hierarchicalResults.length > 0
      ? await this.collectEmbeddableNodes(hierarchicalResults)
      : [];

    await this.emitProgress(
      createSnapshot({
        id: params.jobId,
        type: params.jobType,
        status: "running",
        startedAt: params.startedAt,
        completed: 0,
        total: embeddableNodes.length + chunks.length,
        label: `${params.commandLabel} · Embed`,
        detail:
          embeddableNodes.length === 0 && chunks.length === 0
            ? "No changed chunks require embedding."
            : `Embedding ${embeddableNodes.length} nodes and ${chunks.length} flat chunks.`
      }),
      params.options
    );

    const vectors = await this.embedChunkContent(chunks);
    await this.deps.vectorStoreRepository.deleteByNotePaths(notePathsToDelete);
    await this.deps.vectorStoreRepository.upsertFromChunks(chunks, vectors);

    if (embeddableNodes.length > 0) {
      await this.embedHierarchicalNodes(embeddableNodes);
    }

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

  private async embedChunkContent(chunks: ChunkRecord[]) {
    const settings = this.deps.getSettings();
    if (chunks.length === 0) {
      return [];
    }

    try {
      const response = await this.deps.embeddingService.embed({
        providerId: settings.embeddingProvider,
        model: settings.embeddingModel,
        inputs: chunks.map((chunk) => chunk.content)
      });
      return response.vectors;
    } catch (error: unknown) {
      if (error instanceof EmbeddingBatchError) {
        const failedChunkRefs = error.failedInputIndexes
          .map((index) => chunks[index])
          .filter((chunk): chunk is ChunkRecord => Boolean(chunk))
          .map((chunk) => `${chunk.id} (${chunk.source.notePath})`);
        throw new Error(
          `Embedding batch failed for ${failedChunkRefs.length} chunks: ${failedChunkRefs.join(", ")}`
        );
      }
      throw error;
    }
  }

  private async storeHierarchicalTrees(results: HierarchicalChunkerResult[]): Promise<void> {
    for (const result of results) {
      await this.deps.hierarchicalStore.upsertNodeTree(result.tree);
      await this.deps.hierarchicalStore.upsertCrossReferences(result.crossReferences);
      for (const node of result.tree.nodes.values()) {
        if (node.tags.length > 0) {
          await this.deps.hierarchicalStore.upsertTags(node.nodeId, node.tags);
        }
      }
    }
  }

  private async generateTreeSummaries(results: HierarchicalChunkerResult[]): Promise<void> {
    for (const result of results) {
      try {
        await this.deps.summaryService.generateSummaries(result.tree);
      } catch (error: unknown) {
        this.logger.log({
          level: "warn",
          event: "indexing.hierarchical.summary_failed",
          message: `Summary generation failed for tree "${result.tree.root.noteTitle}"; continuing with remaining trees.`,
          context: {
            operation: "IndexingService.generateTreeSummaries",
            notePath: result.tree.root.notePath,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  }

  private async collectEmbeddableNodes(
    results: HierarchicalChunkerResult[]
  ): Promise<EmbeddableNode[]> {
    const LEAF_TYPES: Set<string> = new Set(["paragraph", "bullet"]);
    const embeddable: EmbeddableNode[] = [];

    for (const result of results) {
      for (const node of result.tree.nodes.values()) {
        if (LEAF_TYPES.has(node.nodeType)) {
          embeddable.push({ node, text: node.content, embeddingType: "content" });
        } else {
          const summaryRecord = await this.deps.hierarchicalStore.getSummary(node.nodeId);
          if (summaryRecord) {
            embeddable.push({ node, text: summaryRecord.summary, embeddingType: "summary" });
          }
        }
      }
    }

    return embeddable;
  }

  private async embedHierarchicalNodes(embeddable: EmbeddableNode[]): Promise<void> {
    if (embeddable.length === 0) {
      return;
    }

    const settings = this.deps.getSettings();

    try {
      const response = await this.deps.embeddingService.embed({
        providerId: settings.embeddingProvider,
        model: settings.embeddingModel,
        inputs: embeddable.map((entry) => entry.text)
      });

      for (let i = 0; i < embeddable.length; i++) {
        const entry = embeddable[i];
        const vector = response.vectors[i];
        await this.deps.hierarchicalStore.upsertEmbedding(entry.node.nodeId, entry.embeddingType, vector);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        withRecoveryAction(`Hierarchical embedding failed: ${message}`, "full")
      );
    }
  }
}

interface EmbeddableNode {
  node: DocumentNode;
  text: string;
  embeddingType: EmbeddingType;
}
