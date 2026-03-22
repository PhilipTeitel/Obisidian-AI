import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIChatProvider } from "../../providers/chat/OpenAIChatProvider";
import { OllamaChatProvider } from "../../providers/chat/OllamaChatProvider";
import type { ChatRequest, ChatStreamEvent, HierarchicalContextBlock } from "../../types";
import { formatHierarchicalContext } from "../../utils/contextFormatter";

const createHierarchicalBlock = (): HierarchicalContextBlock => ({
  notePath: "notes/test.md",
  noteTitle: "Test Note",
  headingTrail: ["Topic A"],
  matchedContent: "Matched paragraph content.",
  siblingContent: "Sibling content.",
  parentSummary: "Parent summary.",
  score: 0.9
});

const createRequestWithHierarchical = (): ChatRequest => ({
  providerId: "openai",
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "What is this about?" }],
  context: [],
  hierarchicalContext: [createHierarchicalBlock()],
  timeoutMs: 1500
});

const createRequestWithFlat = (): ChatRequest => ({
  providerId: "openai",
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "What is this about?" }],
  context: [
    {
      chunkId: "chunk-1",
      notePath: "notes/example.md",
      heading: "Summary",
      snippet: "Flat context snippet.",
      score: 0.9
    }
  ],
  timeoutMs: 1500
});

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
  return { ok: true, status: 200, body } as Response;
};

const createNdjsonResponse = (objects: Record<string, unknown>[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const obj of objects) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }
      controller.close();
    }
  });
  return { ok: true, status: 200, body } as Response;
};

describe("Chat Provider Hierarchical Context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Phase A: Type Extension", () => {
    it("A1 — ChatRequest includes optional hierarchicalContext field", () => {
      const request = createRequestWithHierarchical();
      expect(request.hierarchicalContext).toBeDefined();
      expect(request.hierarchicalContext).toHaveLength(1);
      expect(request.hierarchicalContext![0].headingTrail).toEqual(["Topic A"]);
    });
  });

  describe("Phase B: OpenAI Provider", () => {
    it("B1 — uses formatHierarchicalContext when hierarchicalContext is present", async () => {
      let capturedBody = "";
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return createSseResponse([
          'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
        ]);
      }));

      const provider = new OpenAIChatProvider({
        getEndpoint: () => "https://api.openai.com/v1",
        getApiKey: async () => "test-key"
      });

      const request = createRequestWithHierarchical();
      await collectEvents(provider.complete(request));

      const parsed = JSON.parse(capturedBody);
      const systemMessage = parsed.messages.find(
        (m: { role: string }) => m.role === "system"
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain("Source: notes/test.md");
      expect(systemMessage.content).toContain("# Topic A");
      expect(systemMessage.content).toContain("Summary: Parent summary.");
      expect(systemMessage.content).toContain("Matched paragraph content.");
    });

    it("B2 — falls back to flat context when hierarchicalContext is absent", async () => {
      let capturedBody = "";
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return createSseResponse([
          'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\n'
        ]);
      }));

      const provider = new OpenAIChatProvider({
        getEndpoint: () => "https://api.openai.com/v1",
        getApiKey: async () => "test-key"
      });

      const request = createRequestWithFlat();
      await collectEvents(provider.complete(request));

      const parsed = JSON.parse(capturedBody);
      const systemMessage = parsed.messages.find(
        (m: { role: string }) => m.role === "system"
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain("[1] notes/example.md (Summary)");
      expect(systemMessage.content).toContain("Flat context snippet.");
    });
  });

  describe("Phase C: Ollama Provider", () => {
    it("C1 — uses formatHierarchicalContext when hierarchicalContext is present", async () => {
      let capturedBody = "";
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return createNdjsonResponse([
          { message: { content: "Hello" }, done: false },
          { message: { content: "" }, done: true, done_reason: "stop" }
        ]);
      }));

      const provider = new OllamaChatProvider({
        getEndpoint: () => "http://localhost:11434"
      });

      const request = { ...createRequestWithHierarchical(), providerId: "ollama" as const };
      await collectEvents(provider.complete(request));

      const parsed = JSON.parse(capturedBody);
      const systemMessage = parsed.messages.find(
        (m: { role: string }) => m.role === "system"
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain("Source: notes/test.md");
      expect(systemMessage.content).toContain("# Topic A");
    });

    it("C2 — falls back to flat context when hierarchicalContext is absent", async () => {
      let capturedBody = "";
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return createNdjsonResponse([
          { message: { content: "Hello" }, done: true, done_reason: "stop" }
        ]);
      }));

      const provider = new OllamaChatProvider({
        getEndpoint: () => "http://localhost:11434"
      });

      const request = { ...createRequestWithFlat(), providerId: "ollama" as const };
      await collectEvents(provider.complete(request));

      const parsed = JSON.parse(capturedBody);
      const systemMessage = parsed.messages.find(
        (m: { role: string }) => m.role === "system"
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain("[1] notes/example.md (Summary)");
    });
  });

  describe("Phase D: Shared Formatter Integration", () => {
    it("D1 — both providers produce identical context messages for the same input", async () => {
      const capturedBodies: string[] = [];

      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBodies.push(init.body as string);
        return createSseResponse([
          'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n'
        ]);
      }));

      const openaiProvider = new OpenAIChatProvider({
        getEndpoint: () => "https://api.openai.com/v1",
        getApiKey: async () => "test-key"
      });

      const request = createRequestWithHierarchical();
      await collectEvents(openaiProvider.complete(request));

      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBodies.push(init.body as string);
        return createNdjsonResponse([
          { message: { content: "Hi" }, done: true, done_reason: "stop" }
        ]);
      }));

      const ollamaProvider = new OllamaChatProvider({
        getEndpoint: () => "http://localhost:11434"
      });

      await collectEvents(ollamaProvider.complete({ ...request, providerId: "ollama" }));

      const openaiParsed = JSON.parse(capturedBodies[0]);
      const ollamaParsed = JSON.parse(capturedBodies[1]);

      const openaiSystem = openaiParsed.messages.find(
        (m: { role: string }) => m.role === "system"
      );
      const ollamaSystem = ollamaParsed.messages.find(
        (m: { role: string }) => m.role === "system"
      );

      expect(openaiSystem.content).toBe(ollamaSystem.content);

      const expectedContent = formatHierarchicalContext([createHierarchicalBlock()]);
      expect(openaiSystem.content).toBe(expectedContent);
    });
  });
});
