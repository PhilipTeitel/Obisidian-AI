import type { ProviderId, ProviderRegistryContract, RuntimeBootstrapContext } from "../types";

export class ProviderRegistry implements ProviderRegistryContract {
  private disposed = false;
  private readonly getSettings: RuntimeBootstrapContext["getSettings"];

  public constructor(context: RuntimeBootstrapContext) {
    this.getSettings = context.getSettings;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public getEmbeddingProviderId(): ProviderId {
    return this.getSettings().embeddingProvider;
  }

  public getChatProviderId(): ProviderId {
    return this.getSettings().chatProvider;
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}
