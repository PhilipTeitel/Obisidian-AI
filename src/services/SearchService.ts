import type {
  EmbeddingServiceContract,
  RuntimeBootstrapContext,
  SearchRequest,
  SearchResult,
  SearchServiceContract,
  VectorStoreRepositoryContract
} from "../types";
import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";

export interface SearchServiceDeps {
  embeddingService: EmbeddingServiceContract;
  vectorStoreRepository: VectorStoreRepositoryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

const SEARCH_SELECTION_TOP_K = 5;
const logger = createRuntimeLogger("SearchService");

const normalizeTags = (tags: string[]): string[] => {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].sort((left, right) =>
    left.localeCompare(right)
  );
};

export class SearchService implements SearchServiceContract {
  private disposed = false;
  private readonly deps: SearchServiceDeps;

  public constructor(deps: SearchServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async search(request: SearchRequest): Promise<SearchResult[]> {
    this.assertNotDisposed();
    const operationLogger = logger.withOperation();

    const query = request.query.trim();
    if (query.length === 0 || request.topK <= 0) {
      operationLogger.info({
        event: "search.query.skipped",
        message: "Search query skipped due to empty query or non-positive topK.",
        context: {
          queryLength: query.length,
          topK: request.topK
        }
      });
      return [];
    }

    operationLogger.info({
      event: "search.query.start",
      message: "Search query started.",
      context: {
        queryLength: query.length,
        topK: request.topK,
        minScore: request.minScore
      }
    });

    const settings = this.deps.getSettings();
    const searchStart = Date.now();

    try {
      const embeddingStart = Date.now();
      const embeddingResponse = await this.deps.embeddingService.embed({
        providerId: settings.embeddingProvider,
        model: settings.embeddingModel,
        inputs: [query]
      });
      const embeddingElapsedMs = Date.now() - embeddingStart;
      operationLogger.info({
        event: "search.query.embedding_completed",
        message: "Search query embedding completed.",
        context: {
          elapsedMs: embeddingElapsedMs,
          providerId: settings.embeddingProvider,
          model: settings.embeddingModel
        }
      });

      const queryVector = embeddingResponse.vectors[0];
      if (!queryVector) {
        operationLogger.warn({
          event: "search.query.embedding_empty",
          message: "Search query embedding returned no vectors.",
          context: {
            elapsedMs: embeddingElapsedMs
          }
        });
        return [];
      }

      const vectorSearchStart = Date.now();
      const matches = await this.deps.vectorStoreRepository.queryNearestNeighbors({
        vector: queryVector,
        topK: request.topK,
        minScore: request.minScore
      });
      const vectorSearchElapsedMs = Date.now() - vectorSearchStart;

      const results = matches.map((match) => ({
        chunkId: match.chunkId,
        score: match.score,
        notePath: match.notePath,
        noteTitle: match.noteTitle,
        heading: match.heading,
        snippet: match.snippet,
        tags: normalizeTags(match.tags)
      }));

      operationLogger.info({
        event: "search.query.completed",
        message: "Search query completed.",
        context: {
          resultCount: results.length,
          embeddingElapsedMs,
          vectorSearchElapsedMs,
          elapsedMs: Date.now() - searchStart
        }
      });

      return results;
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "SearchService.search",
        queryLength: query.length,
        topK: request.topK,
        minScore: request.minScore
      });
      operationLogger.error({
        event: "search.query.failed",
        message: "Search query failed.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      throw normalized;
    }
  }

  public async searchSelection(selection: string): Promise<SearchResult[]> {
    this.assertNotDisposed();
    const normalizedSelection = selection.trim();
    if (normalizedSelection.length === 0) {
      return [];
    }

    return this.search({
      query: normalizedSelection,
      topK: SEARCH_SELECTION_TOP_K
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("SearchService is disposed.");
    }
  }
}
