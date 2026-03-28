import type { ChatContextChunk, ChatProvider, ChatRequest, ChatStreamEvent } from "../../types";
import { formatHierarchicalContext } from "../../utils/contextFormatter";
import { fetchStreamWithTimeout, normalizeChatEndpoint, streamNdjsonObjects } from "./httpChatUtils";

const DEFAULT_TIMEOUT_MS = 60_000;

interface OllamaChatProviderDeps {
  getEndpoint: () => string;
  defaultTimeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const mapFinishReason = (finishReason: unknown): "stop" | "length" | "error" => {
  if (typeof finishReason !== "string") {
    return "stop";
  }
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

export class OllamaChatProvider implements ChatProvider {
  public readonly id = "ollama";
  public readonly name = "Ollama Chat";

  private readonly getEndpoint: () => string;
  private readonly defaultTimeoutMs: number;

  public constructor(deps: OllamaChatProviderDeps) {
    this.getEndpoint = deps.getEndpoint;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async *complete(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
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
      `${endpoint}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
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
      throw new Error("Ollama chat stream response has no body.");
    }

    let doneEmitted = false;
    for await (const eventPayload of streamNdjsonObjects(response.body)) {
      if (!isRecord(eventPayload)) {
        throw new Error("Ollama chat stream payload is malformed.");
      }

      const message = eventPayload.message;
      if (isRecord(message) && typeof message.content === "string" && message.content.length > 0) {
        yield { type: "token", text: message.content };
      }

      if (eventPayload.done === true) {
        doneEmitted = true;
        yield {
          type: "done",
          finishReason: mapFinishReason(eventPayload.done_reason ?? eventPayload.finish_reason)
        };
        return;
      }
    }

    if (!doneEmitted) {
      yield { type: "done", finishReason: "stop" };
    }
  }
}
