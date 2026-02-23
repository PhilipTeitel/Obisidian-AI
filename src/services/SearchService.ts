import type {
  EmbeddingServiceContract,
  RuntimeBootstrapContext,
  SearchRequest,
  SearchResult,
  SearchServiceContract,
  VectorStoreRepositoryContract
} from "../types";

export interface SearchServiceDeps {
  embeddingService: EmbeddingServiceContract;
  vectorStoreRepository: VectorStoreRepositoryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

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
    if (this.disposed) {
      throw new Error("SearchService is disposed.");
    }

    const embeddingResponse = await this.deps.embeddingService.embed({
      providerId: this.deps.getSettings().embeddingProvider,
      model: this.deps.getSettings().embeddingModel,
      inputs: [request.query]
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
      snippet: match.snippet
    }));
  }

  public async searchSelection(selection: string): Promise<SearchResult[]> {
    return this.search({
      query: selection,
      topK: 5
    });
  }
}
