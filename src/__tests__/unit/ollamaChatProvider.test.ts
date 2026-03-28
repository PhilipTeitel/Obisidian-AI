import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaChatProvider } from "../../providers/chat/OllamaChatProvider";
import type { ChatRequest, ChatStreamEvent } from "../../types";

const createRequest = (): ChatRequest => {
  return {
    providerId: "ollama",
    model: "llama3.1",
    messages: [{ role: "user", content: "Answer with context only." }],
    context: [
      {
        chunkId: "chunk-1",
        notePath: "notes/local.md",
        heading: "Plan",
        snippet: "Local vault source text.",
        score: 0.8
      }
    ],
    timeoutMs: 2000
  };
};

const collectEvents = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const createNdjsonResponse = (lines: string[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    }
  });
  return {
    ok: true,
    status: 200,
    body
  } as Response;
};

describe("OllamaChatProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A1_posts_ollama_chat_request", async () => {
    const fetchMock = vi.fn(async () => createNdjsonResponse(['{"done":true,"done_reason":"stop"}']));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaChatProvider({
      getEndpoint: () => "http://localhost:11434/"
    });

    const events = await collectEvents(provider.complete(createRequest()));
    expect(events).toEqual([{ type: "done", finishReason: "stop" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const requestBody = JSON.parse(String(init.body ?? "")) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.model).toBe("llama3.1");
    expect(requestBody.stream).toBe(true);
    expect(requestBody.messages[0]?.role).toBe("system");
    expect(requestBody.messages[0]?.content).toContain("notes/local.md");
  });

  it("A2_parses_ndjson_tokens_and_done", async () => {
    const fetchMock = vi.fn(async () =>
      createNdjsonResponse([
        '{"message":{"role":"assistant","content":"Local"}}',
        '{"message":{"role":"assistant","content":" answer"}}',
        '{"done":true,"done_reason":"stop"}'
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaChatProvider({
      getEndpoint: () => "http://localhost:11434"
    });

    const events = await collectEvents(provider.complete(createRequest()));
    expect(events).toEqual([
      { type: "token", text: "Local" },
      { type: "token", text: " answer" },
      { type: "done", finishReason: "stop" }
    ]);
  });

  it("A3_handles_http_timeout_and_malformed_payloads", async () => {
    const nonOkFetch = vi.fn(async () => ({ ok: false, status: 500, body: null } as Response));
    vi.stubGlobal("fetch", nonOkFetch);
    const provider = new OllamaChatProvider({
      getEndpoint: () => "http://localhost:11434"
    });
    await expect(collectEvents(provider.complete(createRequest()))).rejects.toThrow("status 500");

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const timeoutFetch = vi.fn(async () => {
      throw abortError;
    });
    vi.stubGlobal("fetch", timeoutFetch);
    await expect(collectEvents(provider.complete(createRequest()))).rejects.toThrow("timed out");

    const malformedFetch = vi.fn(async () => createNdjsonResponse(["not-json"]));
    vi.stubGlobal("fetch", malformedFetch);
    await expect(collectEvents(provider.complete(createRequest()))).rejects.toThrow("malformed JSON");
  });
});
