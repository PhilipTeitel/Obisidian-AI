import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "../../types";
import { fetchJsonWithTimeout, normalizeBaseEndpoint, toEmbeddingVector } from "./httpEmbeddingUtils";

const DEFAULT_TIMEOUT_MS = 60_000;

interface OllamaEmbeddingProviderDeps {
  getEndpoint: () => string;
  defaultTimeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly id = "ollama";
  public readonly name = "Ollama";

  private readonly getEndpoint: () => string;
  private readonly defaultTimeoutMs: number;

  public constructor(deps: OllamaEmbeddingProviderDeps) {
    this.getEndpoint = deps.getEndpoint;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (request.inputs.length === 0) {
      return {
        providerId: this.id,
        model: request.model,
        vectors: []
      };
    }

    const endpoint = normalizeBaseEndpoint(this.getEndpoint());
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const rawResponse = await fetchJsonWithTimeout(
      `${endpoint}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          input: request.inputs
        })
      },
      timeoutMs
    );

    const vectors = this.extractVectors(rawResponse);
    if (vectors.length !== request.inputs.length) {
      throw new Error(
        `Ollama embedding response count mismatch. expected=${request.inputs.length}, actual=${vectors.length}`
      );
    }

    return {
      providerId: this.id,
      model: request.model,
      vectors
    };
  }

  private extractVectors(rawResponse: unknown) {
    if (!isRecord(rawResponse)) {
      throw new Error("Ollama embedding response payload is malformed.");
    }

    if (Array.isArray(rawResponse.embeddings)) {
      return rawResponse.embeddings.map((entry, index) => toEmbeddingVector(entry, `ollama:embeddings[${index}]`));
    }

    if (Array.isArray(rawResponse.embedding)) {
      return [toEmbeddingVector(rawResponse.embedding, "ollama:embedding")];
    }

    if (Array.isArray(rawResponse.data)) {
      return rawResponse.data.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Ollama embedding response row ${index} is malformed.`);
        }
        return toEmbeddingVector(entry.embedding, `ollama:data[${index}]`);
      });
    }

    throw new Error("Ollama embedding response payload is malformed.");
  }
}
