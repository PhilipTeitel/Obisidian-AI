import type {
  EmbeddingServiceContract,
  ChunkRecord,
  ChunkerInput,
  IndexingServiceContract,
  JobSnapshot,
  JobStatus,
  JobType,
  RuntimeBootstrapContext
} from "../types";
import { chunkMarkdownNote } from "../utils/chunker";
import { crawlVaultMarkdownNotes } from "../utils/vaultCrawler";

export interface IndexingServiceDeps {
  app: RuntimeBootstrapContext["app"];
  embeddingService: EmbeddingServiceContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

const createSnapshot = (params: {
  type: JobType;
  status: JobStatus;
  label: string;
  detail: string;
  errorMessage?: string;
}): JobSnapshot => {
  const now = Date.now();
  const isFinished = params.status === "succeeded" || params.status === "failed" || params.status === "cancelled";
  return {
    id: `${params.type}:${now}`,
    type: params.type,
    status: params.status,
    startedAt: now,
    finishedAt: isFinished ? now : undefined,
    progress: {
      completed: 0,
      total: 0,
      label: params.label,
      detail: params.detail
    },
    errorMessage: params.errorMessage
  };
};

export class IndexingService implements IndexingServiceContract {
  private disposed = false;
  private readonly deps: IndexingServiceDeps;

  public constructor(deps: IndexingServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async reindexVault(): Promise<JobSnapshot> {
    if (this.disposed) {
      throw new Error("IndexingService is disposed.");
    }

    const noteInputs = await this.crawlNotesForIndexing();
    const chunks = noteInputs.flatMap((input) => this.chunkNoteForIndexing(input));

    await this.deps.embeddingService.embed({
      providerId: this.deps.getSettings().embeddingProvider,
      model: this.deps.getSettings().embeddingModel,
      inputs: chunks.map((chunk) => chunk.content)
    });

    return createSnapshot({
      type: "reindex-vault",
      status: "succeeded",
      label: "Reindex vault",
      detail: `Crawled ${noteInputs.length} notes into ${chunks.length} chunks.`
    });
  }

  public async indexChanges(): Promise<JobSnapshot> {
    if (this.disposed) {
      throw new Error("IndexingService is disposed.");
    }

    const noteInputs = await this.crawlNotesForIndexing();
    const chunks = noteInputs.flatMap((input) => this.chunkNoteForIndexing(input));

    await this.deps.embeddingService.embed({
      providerId: this.deps.getSettings().embeddingProvider,
      model: this.deps.getSettings().embeddingModel,
      inputs: chunks.map((chunk) => chunk.content)
    });

    return createSnapshot({
      type: "index-changes",
      status: "succeeded",
      label: "Index changes",
      detail: `Crawled ${noteInputs.length} notes into ${chunks.length} chunks.`
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
}
