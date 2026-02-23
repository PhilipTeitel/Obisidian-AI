import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "../../types";
import { fetchJsonWithTimeout, normalizeBaseEndpoint, toEmbeddingVector } from "./httpEmbeddingUtils";

const DEFAULT_TIMEOUT_MS = 30_000;

interface OpenAIEmbeddingProviderDeps {
  getEndpoint: () => string;
  getApiKey: () => Promise<string | null>;
  defaultTimeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public readonly id = "openai";
  public readonly name = "OpenAI";

  private readonly getEndpoint: () => string;
  private readonly getApiKey: () => Promise<string | null>;
  private readonly defaultTimeoutMs: number;

  public constructor(deps: OpenAIEmbeddingProviderDeps) {
    this.getEndpoint = deps.getEndpoint;
    this.getApiKey = deps.getApiKey;
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

    const apiKey = await this.getApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error("OpenAI provider requires an API key from secret storage.");
    }

    const endpoint = normalizeBaseEndpoint(this.getEndpoint());
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const rawResponse = await fetchJsonWithTimeout(
      `${endpoint}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: request.model,
          input: request.inputs
        })
      },
      timeoutMs
    );

    if (!isRecord(rawResponse) || !Array.isArray(rawResponse.data)) {
      throw new Error("OpenAI embedding response payload is malformed.");
    }

    const vectors = rawResponse.data.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`OpenAI embedding response row ${index} is malformed.`);
      }
      return toEmbeddingVector(entry.embedding, `openai:data[${index}]`);
    });

    if (vectors.length !== request.inputs.length) {
      throw new Error(
        `OpenAI embedding response count mismatch. expected=${request.inputs.length}, actual=${vectors.length}`
      );
    }

    return {
      providerId: this.id,
      model: request.model,
      vectors
    };
  }
}
