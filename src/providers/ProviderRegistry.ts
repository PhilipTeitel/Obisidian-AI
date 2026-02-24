import type { ChatProvider, EmbeddingProvider, ProviderId, ProviderRegistryContract, RuntimeBootstrapContext } from "../types";

export class ProviderRegistry implements ProviderRegistryContract {
  private disposed = false;
  private readonly getSettings: RuntimeBootstrapContext["getSettings"];
  private readonly embeddingProviders = new Map<ProviderId, EmbeddingProvider>();
  private readonly chatProviders = new Map<ProviderId, ChatProvider>();

  public constructor(context: RuntimeBootstrapContext) {
    this.getSettings = context.getSettings;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.embeddingProviders.clear();
    this.chatProviders.clear();
  }

  public getEmbeddingProviderId(): ProviderId {
    return this.getSettings().embeddingProvider;
  }

  public getChatProviderId(): ProviderId {
    return this.getSettings().chatProvider;
  }

  public registerEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProviders.set(provider.id, provider);
  }

  public getEmbeddingProvider(providerId: ProviderId = this.getEmbeddingProviderId()): EmbeddingProvider {
    const provider = this.embeddingProviders.get(providerId);
    if (!provider) {
      throw new Error(`Embedding provider is not registered: ${providerId}`);
    }
    return provider;
  }

  public listEmbeddingProviders(): EmbeddingProvider[] {
    return [...this.embeddingProviders.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  }

  public registerChatProvider(provider: ChatProvider): void {
    this.chatProviders.set(provider.id, provider);
  }

  public getChatProvider(providerId: ProviderId = this.getChatProviderId()): ChatProvider {
    const provider = this.chatProviders.get(providerId);
    if (!provider) {
      throw new Error(`Chat provider is not registered: ${providerId}`);
    }
    return provider;
  }

  public listChatProviders(): ChatProvider[] {
    return [...this.chatProviders.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}
