import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIEmbeddingProvider } from "../../providers/embeddings/OpenAIEmbeddingProvider";
import type { EmbeddingRequest } from "../../types";

const createRequest = (): EmbeddingRequest => {
  return {
    providerId: "openai",
    model: "text-embedding-3-small",
    inputs: ["alpha", "beta"]
  };
};

describe("OpenAIEmbeddingProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls configured endpoint with bearer auth and parses vectors", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIEmbeddingProvider({
      getEndpoint: () => "https://api.openai.com/v1/",
      getApiKey: async () => "test-key"
    });

    const response = await provider.embed(createRequest());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.vectors).toHaveLength(2);
    expect(response.vectors[0].dimensions).toBe(2);
  });

  it("fails when secret store has no OpenAI API key", async () => {
    const provider = new OpenAIEmbeddingProvider({
      getEndpoint: () => "https://api.openai.com/v1",
      getApiKey: async () => null
    });

    await expect(provider.embed(createRequest())).rejects.toThrow("API key");
  });
});
