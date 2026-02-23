import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaEmbeddingProvider } from "../../providers/embeddings/OllamaEmbeddingProvider";
import type { EmbeddingRequest } from "../../types";

const createRequest = (): EmbeddingRequest => {
  return {
    providerId: "ollama",
    model: "nomic-embed-text",
    inputs: ["alpha", "beta"]
  };
};

describe("OllamaEmbeddingProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses embeddings array payload from Ollama", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4]
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaEmbeddingProvider({
      getEndpoint: () => "http://localhost:11434/"
    });

    const response = await provider.embed(createRequest());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.vectors).toHaveLength(2);
    expect(response.vectors[1].values).toEqual([0.3, 0.4]);
  });

  it("throws for malformed payloads", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        embeddings: "invalid"
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaEmbeddingProvider({
      getEndpoint: () => "http://localhost:11434"
    });

    await expect(provider.embed(createRequest())).rejects.toThrow("malformed");
  });
});
