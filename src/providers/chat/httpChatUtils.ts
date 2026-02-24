const normalizeSseBlock = (rawBlock: string): string[] => {
  return rawBlock
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
};

const extractSseData = (rawBlock: string): string | null => {
  const dataLines = normalizeSseBlock(rawBlock)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
};

export const normalizeChatEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    throw new Error("Chat provider endpoint is not configured.");
  }
  return trimmed.replace(/\/+$/, "");
};

export const fetchStreamWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
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
      throw new Error(`Chat request failed with status ${response.status}.`);
    }
    if (!response.body) {
      throw new Error("Chat request succeeded but response stream body was empty.");
    }
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Chat request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const streamSseDataLines = async function* (body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex < 0) {
          break;
        }
        const rawBlock = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const data = extractSseData(rawBlock);
        if (data !== null) {
          yield data;
        }
      }
    }

    buffer += decoder.decode();
    const trailingData = extractSseData(buffer);
    if (trailingData !== null) {
      yield trailingData;
    }
  } finally {
    reader.releaseLock();
  }
};

export const streamNdjsonObjects = async function* (body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newLineIndex = buffer.indexOf("\n");
        if (newLineIndex < 0) {
          break;
        }
        const line = buffer.slice(0, newLineIndex).trim();
        buffer = buffer.slice(newLineIndex + 1);
        if (line.length === 0) {
          continue;
        }
        try {
          yield JSON.parse(line);
        } catch {
          throw new Error("Chat stream payload is malformed JSON.");
        }
      }
    }

    buffer += decoder.decode();
    const trailingLine = buffer.trim();
    if (trailingLine.length > 0) {
      try {
        yield JSON.parse(trailingLine);
      } catch {
        throw new Error("Chat stream payload is malformed JSON.");
      }
    }
  } finally {
    reader.releaseLock();
  }
};
