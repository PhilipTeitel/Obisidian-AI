import type { ChatContextChunk, ChatProvider, ChatRequest, ChatStreamEvent } from "../../types";
import { formatHierarchicalContext } from "../../utils/contextFormatter";
import { fetchStreamWithTimeout, normalizeChatEndpoint, streamSseDataLines } from "./httpChatUtils";

const DEFAULT_TIMEOUT_MS = 30_000;

interface OpenAIChatProviderDeps {
  getEndpoint: () => string;
  getApiKey: () => Promise<string | null>;
  defaultTimeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const mapFinishReason = (finishReason: string): "stop" | "length" | "error" => {
  if (finishReason === "stop") {
    return "stop";
  }
  if (finishReason === "length") {
    return "length";
  }
  return "error";
};

const formatContext = (context: ChatContextChunk[]): string => {
  if (context.length === 0) {
    return "";
  }
  const serialized = context
    .map((chunk, index) => {
      const heading = chunk.heading ? ` (${chunk.heading})` : "";
      return `[${index + 1}] ${chunk.notePath}${heading}\n${chunk.snippet}`;
    })
    .join("\n\n");
  return `Use only the vault context below when answering the user.\n\n${serialized}`;
};

export class OpenAIChatProvider implements ChatProvider {
  public readonly id = "openai";
  public readonly name = "OpenAI Chat";

  private readonly getEndpoint: () => string;
  private readonly getApiKey: () => Promise<string | null>;
  private readonly defaultTimeoutMs: number;

  public constructor(deps: OpenAIChatProviderDeps) {
    this.getEndpoint = deps.getEndpoint;
    this.getApiKey = deps.getApiKey;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async *complete(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const apiKey = await this.getApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error("OpenAI chat provider requires an API key from secret storage.");
    }

    const endpoint = normalizeChatEndpoint(this.getEndpoint());
    const timeoutMs = request.timeoutMs > 0 ? request.timeoutMs : this.defaultTimeoutMs;
    const contextMessage =
      request.hierarchicalContext && request.hierarchicalContext.length > 0
        ? formatHierarchicalContext(request.hierarchicalContext)
        : formatContext(request.context);
    const payloadMessages =
      contextMessage.length === 0
        ? request.messages
        : [{ role: "system" as const, content: contextMessage }, ...request.messages];

    const response = await fetchStreamWithTimeout(
      `${endpoint}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages: payloadMessages
        })
      },
      timeoutMs
    );

    if (!response.body) {
      throw new Error("OpenAI chat stream response has no body.");
    }

    let doneEmitted = false;
    for await (const dataLine of streamSseDataLines(response.body)) {
      if (dataLine === "[DONE]") {
        if (!doneEmitted) {
          doneEmitted = true;
          yield { type: "done", finishReason: "stop" };
        }
        return;
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(dataLine);
      } catch {
        throw new Error("OpenAI chat stream payload is malformed.");
      }

      if (!isRecord(parsedData) || !Array.isArray(parsedData.choices)) {
        throw new Error("OpenAI chat stream payload is malformed.");
      }

      const firstChoice = parsedData.choices[0];
      if (!isRecord(firstChoice)) {
        throw new Error("OpenAI chat stream choice payload is malformed.");
      }

      const delta = firstChoice.delta;
      if (isRecord(delta) && typeof delta.content === "string" && delta.content.length > 0) {
        yield { type: "token", text: delta.content };
      }

      if (typeof firstChoice.finish_reason === "string") {
        doneEmitted = true;
        yield { type: "done", finishReason: mapFinishReason(firstChoice.finish_reason) };
        return;
      }
    }

    if (!doneEmitted) {
      yield { type: "done", finishReason: "stop" };
    }
  }
}
