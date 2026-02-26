import type {
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingServiceContract,
  ProviderRegistryContract,
  RuntimeBootstrapContext
} from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import { EmbeddingBatchError } from "./errors/EmbeddingBatchError";

export interface EmbeddingServiceDeps {
  providerRegistry: ProviderRegistryContract;
  getSettings: RuntimeBootstrapContext["getSettings"];
}

const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const logger = createRuntimeLogger("EmbeddingService");

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
    const operationLogger = logger.withOperation();
    const operationStartedAt = Date.now();

    const activeProviderId = this.deps.providerRegistry.getEmbeddingProviderId();
    const configuredModel = this.deps.getSettings().embeddingModel;
    const providerId = request.providerId || activeProviderId;
    const model = request.model || configuredModel;

    if (request.inputs.length === 0) {
      operationLogger.info({
        event: "embedding.operation.skipped_empty",
        message: "Embedding request skipped because inputs are empty.",
        context: {
          providerId,
          model
        }
      });
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
    operationLogger.info({
      event: "embedding.operation.start",
      message: "Embedding operation started.",
      context: {
        providerId,
        model,
        inputCount: request.inputs.length,
        batchSize,
        maxRetries,
        timeoutMs
      }
    });

    const vectors = new Array(request.inputs.length) as EmbeddingResponse["vectors"];
    let completedBatchCount = 0;
    for (let start = 0; start < request.inputs.length; start += batchSize) {
      const end = Math.min(start + batchSize, request.inputs.length);
      const batchInputs = request.inputs.slice(start, end);
      let attempt = 0;
      const batchStartedAt = Date.now();
      operationLogger.info({
        event: "embedding.batch.start",
        message: "Embedding batch started.",
        context: {
          batchStart: start,
          batchEnd: end - 1,
          batchSize: batchInputs.length
        }
      });

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
          completedBatchCount += 1;
          operationLogger.info({
            event: "embedding.batch.completed",
            message: "Embedding batch completed.",
            context: {
              batchStart: start,
              batchEnd: end - 1,
              attempt: attempt + 1,
              elapsedMs: Date.now() - batchStartedAt
            }
          });
          break;
        } catch (error: unknown) {
          attempt += 1;
          operationLogger.warn({
            event: "embedding.batch.attempt_failed",
            message: "Embedding batch attempt failed.",
            context: {
              batchStart: start,
              batchEnd: end - 1,
              attempt,
              maxRetries
            }
          });
          if (attempt > maxRetries) {
            const failedIndexes = Array.from({ length: end - start }, (_, offset) => start + offset);
            operationLogger.error({
              event: "embedding.batch.failed",
              message: "Embedding batch failed after retries were exhausted.",
              context: {
                batchStart: start,
                batchEnd: end - 1,
                attempt,
                maxRetries,
                elapsedMs: Date.now() - batchStartedAt
              }
            });
            throw new EmbeddingBatchError(
              `Embedding batch failed for provider ${providerId} after ${attempt} attempts.`,
              failedIndexes,
              error
            );
          }
          operationLogger.info({
            event: "embedding.batch.retry_scheduled",
            message: "Embedding batch retry scheduled.",
            context: {
              batchStart: start,
              batchEnd: end - 1,
              nextAttempt: attempt + 1
            }
          });
        }
      }
    }

    operationLogger.info({
      event: "embedding.operation.completed",
      message: "Embedding operation completed.",
      context: {
        providerId,
        model,
        inputCount: request.inputs.length,
        completedBatchCount,
        elapsedMs: Date.now() - operationStartedAt
      }
    });
    return {
      providerId,
      model,
      vectors
    };
  }
}
