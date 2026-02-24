import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIChatProvider } from "../../providers/chat/OpenAIChatProvider";
import type { ChatRequest, ChatStreamEvent } from "../../types";

const createRequest = (): ChatRequest => {
  return {
    providerId: "openai",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Summarize the context." }],
    context: [
      {
        chunkId: "chunk-1",
        notePath: "notes/example.md",
        heading: "Summary",
        snippet: "Vault-only context snippet.",
        score: 0.9
      }
    ],
    timeoutMs: 1500
  };
};

const collectEvents = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const createSseResponse = (frames: string[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
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

describe("OpenAIChatProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A1_posts_streaming_chat_request", async () => {
    const fetchMock = vi.fn(async () => createSseResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIChatProvider({
      getEndpoint: () => "https://api.openai.com/v1/",
      getApiKey: async () => "test-openai-key"
    });

    const events = await collectEvents(provider.complete(createRequest()));
    expect(events).toEqual([{ type: "done", finishReason: "stop" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-openai-key"
    });

    const requestBodyText = String(init.body ?? "");
    const requestBody = JSON.parse(requestBodyText) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.model).toBe("gpt-4o-mini");
    expect(requestBody.stream).toBe(true);
    expect(requestBody.messages[0]?.role).toBe("system");
    expect(requestBody.messages[0]?.content).toContain("notes/example.md");
  });

  it("A2_parses_sse_tokens_and_done", async () => {
    const fetchMock = vi.fn(async () =>
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n'
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIChatProvider({
      getEndpoint: () => "https://api.openai.com/v1",
      getApiKey: async () => "test-openai-key"
    });

    const events = await collectEvents(provider.complete(createRequest()));
    expect(events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
      { type: "done", finishReason: "stop" }
    ]);
  });

  it("A3_handles_auth_http_timeout_failures", async () => {
    const missingKeyProvider = new OpenAIChatProvider({
      getEndpoint: () => "https://api.openai.com/v1",
      getApiKey: async () => null
    });
    await expect(collectEvents(missingKeyProvider.complete(createRequest()))).rejects.toThrow("API key");

    const nonOkFetch = vi.fn(async () => ({ ok: false, status: 401, body: null } as Response));
    vi.stubGlobal("fetch", nonOkFetch);
    const nonOkProvider = new OpenAIChatProvider({
      getEndpoint: () => "https://api.openai.com/v1",
      getApiKey: async () => "test-openai-key"
    });
    await expect(collectEvents(nonOkProvider.complete(createRequest()))).rejects.toThrow("status 401");

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const timeoutFetch = vi.fn(async () => {
      throw abortError;
    });
    vi.stubGlobal("fetch", timeoutFetch);
    const timeoutProvider = new OpenAIChatProvider({
      getEndpoint: () => "https://api.openai.com/v1",
      getApiKey: async () => "test-openai-key"
    });
    await expect(collectEvents(timeoutProvider.complete(createRequest()))).rejects.toThrow("timed out");
  });
});
