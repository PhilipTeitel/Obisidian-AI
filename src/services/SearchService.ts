import type {
  EmbeddingServiceContract,
  RuntimeBootstrapContext,
  SearchRequest,
  SearchResult,
  SearchServiceContract
} from "../types";

export interface SearchServiceDeps {
  embeddingService: EmbeddingServiceContract;
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

    await this.deps.embeddingService.embed({
      providerId: this.deps.getSettings().embeddingProvider,
      model: this.deps.getSettings().embeddingModel,
      inputs: [request.query]
    });

    return [];
  }

  public async searchSelection(selection: string): Promise<SearchResult[]> {
    return this.search({
      query: selection,
      topK: 5
    });
  }
}
