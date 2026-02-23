import type { EmbeddingVector } from "../../types";

export const normalizeBaseEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    throw new Error("Embedding provider endpoint is not configured.");
  }
  return trimmed.replace(/\/+$/, "");
};

export const toEmbeddingVector = (raw: unknown, contextLabel: string): EmbeddingVector => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Embedding response is invalid (${contextLabel}): expected non-empty numeric array.`);
  }
  if (!raw.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`Embedding response is invalid (${contextLabel}): contains non-numeric values.`);
  }
  return {
    values: [...raw],
    dimensions: raw.length
  };
};

export const fetchJsonWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed with status ${response.status}.`);
    }
    return response.json();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Embedding request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
