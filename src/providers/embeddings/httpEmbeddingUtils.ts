import type { EmbeddingVector } from "../../types";
import { createRuntimeLogger } from "../../logging/runtimeLogger";

const logger = createRuntimeLogger("httpEmbeddingUtils");

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

const toHeaderRecord = (headers: HeadersInit | undefined): Record<string, string> => {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
};

const redactSensitiveHeaders = (headers: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === "authorization" || normalizedKey === "cookie" || normalizedKey.includes("api-key")) {
        return [key, "[REDACTED]"];
      }
      return [key, value];
    })
  );
};

export const fetchJsonWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> => {
  const operationLogger = logger.withOperation();
  const requestStartedAt = Date.now();
  const method = init.method ?? "GET";
  operationLogger.info({
    event: "provider.http.request.start",
    message: "Embedding HTTP request started.",
    context: {
      method,
      url,
      timeoutMs,
      headers: JSON.stringify(redactSensitiveHeaders(toHeaderRecord(init.headers)))
    }
  });

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
      operationLogger.error({
        event: "provider.http.request.failed_status",
        message: "Embedding HTTP request returned non-success status.",
        context: {
          method,
          url,
          status: response.status,
          elapsedMs: Date.now() - requestStartedAt
        }
      });
      throw new Error(`Embedding request failed with status ${response.status}.`);
    }
    operationLogger.info({
      event: "provider.http.request.completed",
      message: "Embedding HTTP request completed.",
      context: {
        method,
        url,
        status: response.status,
        elapsedMs: Date.now() - requestStartedAt
      }
    });
    return response.json();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      operationLogger.error({
        event: "provider.http.request.timeout",
        message: "Embedding HTTP request timed out.",
        context: {
          method,
          url,
          timeoutMs,
          elapsedMs: Date.now() - requestStartedAt
        }
      });
      throw new Error(`Embedding request timed out after ${timeoutMs}ms.`);
    }
    operationLogger.error({
      event: "provider.http.request.error",
      message: "Embedding HTTP request failed.",
      context: {
        method,
        url,
        elapsedMs: Date.now() - requestStartedAt
      }
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
