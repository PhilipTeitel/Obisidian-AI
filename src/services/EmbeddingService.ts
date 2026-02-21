import type {
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingServiceContract,
  ProviderRegistryContract,
  RuntimeBootstrapContext
} from "../types";

export interface EmbeddingServiceDeps {
  providerRegistry: ProviderRegistryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

export class EmbeddingService implements EmbeddingServiceContract {
  private disposed = false;
  private readonly deps: EmbeddingServiceDeps;

  public constructor(deps: EmbeddingServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (this.disposed) {
      throw new Error("EmbeddingService is disposed.");
    }

    const activeProviderId = this.deps.providerRegistry.getEmbeddingProviderId();
    const configuredModel = this.deps.getSettings().embeddingModel;

    return {
      providerId: request.providerId || activeProviderId,
      model: request.model || configuredModel,
      vectors: request.inputs.map(() => ({
        values: [],
        dimensions: 0
      }))
    };
  }
}
