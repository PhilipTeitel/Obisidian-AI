import type {
  EmbeddingServiceContract,
  RuntimeBootstrapContext,
  SearchRequest,
  SearchResult,
  SearchServiceContract,
  VectorStoreRepositoryContract
} from "../types";
import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";

export interface SearchServiceDeps {
  embeddingService: EmbeddingServiceContract;
  vectorStoreRepository: VectorStoreRepositoryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

const SEARCH_SELECTION_TOP_K = 5;

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

    const query = request.query.trim();
    if (query.length === 0 || request.topK <= 0) {
      return [];
    }

    const settings = this.deps.getSettings();

    try {
      const embeddingResponse = await this.deps.embeddingService.embed({
        providerId: settings.embeddingProvider,
        model: settings.embeddingModel,
        inputs: [query]
      });

      const queryVector = embeddingResponse.vectors[0];
      if (!queryVector) {
        return [];
      }

      const matches = await this.deps.vectorStoreRepository.queryNearestNeighbors({
        vector: queryVector,
        topK: request.topK,
        minScore: request.minScore
      });

      return matches.map((match) => ({
        chunkId: match.chunkId,
        score: match.score,
        notePath: match.notePath,
        noteTitle: match.noteTitle,
        heading: match.heading,
        snippet: match.snippet,
        tags: normalizeTags(match.tags)
      }));
    } catch (error: unknown) {
      throw normalizeRuntimeError(error, {
        operation: "SearchService.search",
        queryLength: query.length,
        topK: request.topK,
        minScore: request.minScore
      });
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
