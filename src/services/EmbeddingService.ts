import type {
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingServiceContract,
  ProviderRegistryContract,
  RuntimeBootstrapContext
} from "../types";
import { EmbeddingBatchError } from "./errors/EmbeddingBatchError";

export interface EmbeddingServiceDeps {
  providerRegistry: ProviderRegistryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;

const toPositiveInteger = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
};

const toNonNegativeInteger = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value) || value === undefined || value < 0) {
    return fallback;
  }
  return Math.floor(value);
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Embedding request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

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
    const providerId = request.providerId || activeProviderId;
    const model = request.model || configuredModel;

    if (request.inputs.length === 0) {
      return {
        providerId,
        model,
        vectors: []
      };
    }

    const provider = this.deps.providerRegistry.getEmbeddingProvider(providerId);
    const batchSize = toPositiveInteger(request.batchSize, DEFAULT_EMBEDDING_BATCH_SIZE);
    const maxRetries = toNonNegativeInteger(request.maxRetries, DEFAULT_MAX_RETRIES);
    const timeoutMs = toPositiveInteger(request.timeoutMs, DEFAULT_TIMEOUT_MS);

    const vectors = new Array(request.inputs.length) as EmbeddingResponse["vectors"];
    for (let start = 0; start < request.inputs.length; start += batchSize) {
      const end = Math.min(start + batchSize, request.inputs.length);
      const batchInputs = request.inputs.slice(start, end);
      let attempt = 0;

      while (true) {
        try {
          const response = await withTimeout(
            provider.embed({
              providerId,
              model,
              inputs: batchInputs,
              timeoutMs
            }),
            timeoutMs
          );

          if (response.vectors.length !== batchInputs.length) {
            throw new Error(
              `Embedding provider returned mismatched vector count for batch ${start}-${end - 1}. expected=${batchInputs.length}, actual=${response.vectors.length}`
            );
          }

          for (let index = 0; index < response.vectors.length; index += 1) {
            vectors[start + index] = response.vectors[index];
          }
          break;
        } catch (error: unknown) {
          attempt += 1;
          if (attempt > maxRetries) {
            const failedIndexes = Array.from({ length: end - start }, (_, offset) => start + offset);
            throw new EmbeddingBatchError(
              `Embedding batch failed for provider ${providerId} after ${attempt} attempts.`,
              failedIndexes,
              error
            );
          }
        }
      }
    }

    return {
      providerId,
      model,
      vectors
    };
  }
}
