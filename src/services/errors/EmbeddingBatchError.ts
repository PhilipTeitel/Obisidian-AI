import type { EmbeddingInputFailure } from "../../types";

export class EmbeddingBatchError extends Error {
  public readonly failedInputIndexes: number[];
  public readonly failures: EmbeddingInputFailure[];

  public constructor(message: string, failedInputIndexes: number[], cause?: unknown) {
    super(message);
    this.name = "EmbeddingBatchError";
    this.failedInputIndexes = [...new Set(failedInputIndexes)].sort((left, right) => left - right);
    this.failures = this.failedInputIndexes.map((inputIndex) => ({
      inputIndex,
      message
    }));
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
