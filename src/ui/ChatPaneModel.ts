import { normalizeRuntimeError } from "../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import type {
  ChatContextChunk,
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ObsidianAISettings,
  SearchResult
} from "../types";

export type ChatPaneStatus = "idle" | "streaming" | "error";
export type ChatTurnStatus = "streaming" | "complete" | "cancelled" | "error";

export interface ChatTurn {
  id: string;
  userMessage: string;
  assistantMessage: string;
  sources: ChatContextChunk[];
  status: ChatTurnStatus;
  errorMessage?: string;
}

export interface ChatPaneState {
  draft: string;
  status: ChatPaneStatus;
  turns: ChatTurn[];
  errorMessage?: string;
  canSend: boolean;
  canCancel: boolean;
}

interface ChatPaneModelDeps {
  runChat: (request: ChatRequest) => AsyncIterable<ChatStreamEvent>;
  runSourceSearch: (query: string) => Promise<SearchResult[]>;
  openSource: (source: ChatContextChunk) => Promise<void>;
  getSettings: () => ObsidianAISettings;
  notify: (message: string) => void;
}

type ChatPaneListener = (state: ChatPaneState) => void;

const SOURCE_TOP_K = 5;
const logger = createRuntimeLogger("ChatPaneModel");

const mapSources = (results: SearchResult[]): ChatContextChunk[] => {
  return results.map((result) => ({
    chunkId: result.chunkId,
    notePath: result.notePath,
    heading: result.heading,
    snippet: result.snippet,
    score: result.score
  }));
};

export class ChatPaneModel {
  private state: ChatPaneState = {
    draft: "",
    status: "idle",
    turns: [],
    canSend: true,
    canCancel: false
  };

  private readonly deps: ChatPaneModelDeps;
  private readonly listeners = new Set<ChatPaneListener>();
  private activeIterator: AsyncIterator<ChatStreamEvent> | null = null;
  private activeTurnId: string | null = null;
  private cancelRequested = false;

  public constructor(deps: ChatPaneModelDeps) {
    this.deps = deps;
  }

  public getState(): ChatPaneState {
    return {
      ...this.state,
      turns: this.state.turns.map((turn) => ({
        ...turn,
        sources: [...turn.sources]
      }))
    };
  }

  public subscribe(listener: ChatPaneListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setDraft(draft: string): void {
    this.updateState({
      draft
    });
  }

  public async send(draftInput?: string): Promise<boolean> {
    const operationLogger = logger.withOperation();
    if (this.state.status === "streaming") {
      operationLogger.warn({
        event: "chat.pane.send.skipped_streaming",
        message: "Chat send skipped because a stream is already active."
      });
      return false;
    }

    const draft = (draftInput ?? this.state.draft).trim();
    if (draft.length === 0) {
      operationLogger.info({
        event: "chat.pane.send.skipped_empty",
        message: "Chat send skipped because draft is empty."
      });
      this.updateState({
        draft: "",
        errorMessage: undefined
      });
      return false;
    }

    const turnId = `turn-${Date.now()}`;
    const turn: ChatTurn = {
      id: turnId,
      userMessage: draft,
      assistantMessage: "",
      sources: [],
      status: "streaming"
    };
    const sendStartedAt = Date.now();
    operationLogger.info({
      event: "chat.pane.send.start",
      message: "Chat pane send started.",
      context: {
        turnId,
        draftLength: draft.length,
        priorTurnCount: this.state.turns.length
      }
    });

    const sourceResults = await this.safeRunSourceSearch(draft);
    turn.sources = mapSources(sourceResults);
    operationLogger.info({
      event: "chat.pane.send.sources_resolved",
      message: "Chat pane source retrieval completed.",
      context: {
        turnId,
        sourceCount: sourceResults.length
      }
    });

    this.activeTurnId = turnId;
    this.cancelRequested = false;
    this.updateState({
      draft: "",
      status: "streaming",
      errorMessage: undefined,
      canSend: false,
      canCancel: true,
      turns: [...this.state.turns, turn]
    });

    const settings = this.deps.getSettings();
    const request: ChatRequest = {
      providerId: settings.chatProvider,
      model: settings.chatModel,
      messages: this.buildMessagesForNextRequest(turn.userMessage),
      context: [],
      timeoutMs: settings.chatTimeout
    };

    try {
      const stream = this.deps.runChat(request);
      this.activeIterator = stream[Symbol.asyncIterator]();
      let tokenEventCount = 0;
      while (true) {
        if (this.cancelRequested) {
          this.updateTurn(turnId, { status: "cancelled" });
          operationLogger.warn({
            event: "chat.pane.send.cancelled",
            message: "Chat pane stream cancelled.",
            context: {
              turnId
            }
          });
          break;
        }

        const nextEvent = await this.activeIterator.next();
        if (nextEvent.done) {
          break;
        }
        if (nextEvent.value.type === "token") {
          tokenEventCount += 1;
          const currentAssistantMessage = this.findTurn(turnId)?.assistantMessage ?? "";
          this.updateTurn(turnId, {
            assistantMessage: `${currentAssistantMessage}${nextEvent.value.text}`
          });
          continue;
        }
        if (nextEvent.value.type === "error") {
          operationLogger.error({
            event: "chat.pane.send.stream_error_event",
            message: "Chat pane received stream error event.",
            context: {
              turnId,
              retryable: nextEvent.value.retryable
            }
          });
          this.updateTurn(turnId, {
            status: "error",
            errorMessage: nextEvent.value.message
          });
          this.updateState({
            status: "error",
            errorMessage: nextEvent.value.message
          });
          this.deps.notify(nextEvent.value.message);
          break;
        }
        if (nextEvent.value.type === "done") {
          operationLogger.info({
            event: "chat.pane.send.stream_done_event",
            message: "Chat pane received stream done event.",
            context: {
              turnId,
              finishReason: nextEvent.value.finishReason
            }
          });
          if (nextEvent.value.finishReason === "error") {
            this.updateTurn(turnId, {
              status: "error",
              errorMessage: "Chat provider completed with an error."
            });
            this.updateState({
              status: "error",
              errorMessage: "Chat provider completed with an error."
            });
          } else if (!this.cancelRequested) {
            this.updateTurn(turnId, { status: "complete" });
          }
          break;
        }
      }

      if (!this.cancelRequested) {
        const activeTurn = this.findTurn(turnId);
        if (activeTurn && activeTurn.status === "streaming") {
          this.updateTurn(turnId, { status: "complete" });
        }
      }
      operationLogger.info({
        event: "chat.pane.send.completed",
        message: "Chat pane send completed.",
        context: {
          turnId,
          tokenEventCount,
          finalStatus: this.findTurn(turnId)?.status,
          elapsedMs: Date.now() - sendStartedAt
        }
      });
      return true;
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "ChatPaneModel.send",
        turnId,
        draftLength: draft.length
      });
      operationLogger.error({
        event: "chat.pane.send.failed",
        message: "Chat pane send failed.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      this.updateTurn(turnId, {
        status: "error",
        errorMessage: normalized.userMessage
      });
      this.updateState({
        status: "error",
        errorMessage: normalized.userMessage
      });
      this.deps.notify(normalized.userMessage);
      return false;
    } finally {
      this.activeIterator = null;
      this.activeTurnId = null;
      this.cancelRequested = false;
      this.updateState({
        status: this.state.status === "error" ? "error" : "idle",
        canSend: true,
        canCancel: false
      });
    }
  }

  public cancelStreaming(): boolean {
    const operationLogger = logger.withOperation();
    if (this.state.status !== "streaming") {
      operationLogger.info({
        event: "chat.pane.cancel.skipped_not_streaming",
        message: "Cancel stream ignored because no active stream exists."
      });
      return false;
    }
    this.cancelRequested = true;
    const iterator = this.activeIterator;
    if (iterator?.return) {
      void iterator.return();
    }
    if (this.activeTurnId) {
      this.updateTurn(this.activeTurnId, { status: "cancelled" });
    }
    operationLogger.info({
      event: "chat.pane.cancel.requested",
      message: "Cancel requested for active chat stream.",
      context: {
        turnId: this.activeTurnId
      }
    });
    return true;
  }

  public async openSource(source: ChatContextChunk): Promise<void> {
    const operationLogger = logger.withOperation();
    operationLogger.info({
      event: "chat.pane.open_source.start",
      message: "Opening chat source from pane.",
      context: {
        notePath: source.notePath,
        heading: source.heading
      }
    });
    try {
      await this.deps.openSource(source);
      operationLogger.info({
        event: "chat.pane.open_source.completed",
        message: "Opened chat source from pane.",
        context: {
          notePath: source.notePath,
          heading: source.heading
        }
      });
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "ChatPaneModel.openSource",
        notePath: source.notePath,
        heading: source.heading
      });
      operationLogger.error({
        event: "chat.pane.open_source.failed",
        message: "Failed to open chat source from pane.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      this.deps.notify(normalized.userMessage);
    }
  }

  private buildMessagesForNextRequest(nextUserMessage: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const turn of this.state.turns) {
      messages.push({ role: "user", content: turn.userMessage });
      if (turn.assistantMessage.trim().length > 0) {
        messages.push({ role: "assistant", content: turn.assistantMessage });
      }
    }
    messages.push({ role: "user", content: nextUserMessage });
    return messages;
  }

  private findTurn(turnId: string): ChatTurn | undefined {
    return this.state.turns.find((turn) => turn.id === turnId);
  }

  private updateTurn(turnId: string, patch: Partial<ChatTurn>): void {
    const turns = this.state.turns.map((turn) => {
      if (turn.id !== turnId) {
        return turn;
      }
      return {
        ...turn,
        ...patch
      };
    });
    this.updateState({ turns });
  }

  private async safeRunSourceSearch(query: string): Promise<SearchResult[]> {
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    try {
      const results = await this.deps.runSourceSearch(query);
      operationLogger.info({
        event: "chat.pane.source_search.completed",
        message: "Chat pane source search completed.",
        context: {
          queryLength: query.length,
          resultCount: results.length,
          elapsedMs: Date.now() - startedAt
        }
      });
      return results;
    } catch (error: unknown) {
      const normalized = normalizeRuntimeError(error, {
        operation: "ChatPaneModel.sourceSearch",
        queryLength: query.length,
        topK: SOURCE_TOP_K
      });
      operationLogger.error({
        event: "chat.pane.source_search.failed",
        message: "Chat pane source search failed.",
        domain: normalized.domain,
        context: normalized.context,
        error: normalized
      });
      this.deps.notify(normalized.userMessage);
      return [];
    }
  }

  private updateState(patch: Partial<ChatPaneState>): void {
    this.state = {
      ...this.state,
      ...patch,
      turns: patch.turns ? [...patch.turns] : this.state.turns
    };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
