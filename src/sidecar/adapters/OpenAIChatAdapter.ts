import type { ChatMessage } from '../../core/domain/types.js';
import { normalizeProviderTokenUsage, unavailableProviderTokenUsage } from '../../core/domain/agentRunTrace.js';
import type { ChatCompletionOptions, IChatPort } from '../../core/ports/IChatPort.js';
import { buildMessagesWithContext } from './chatProviderMessages.js';
import { composeAbortSignal } from './composeAbortSignal.js';
import { readWithAbort } from './readWithAbort.js';

export interface OpenAIChatConfig {
  baseUrl: string;
  model: string;
}

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function openAiUrl(baseUrl: string, path: string): string {
  const base = trimBaseUrl(baseUrl);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export class OpenAIChatAdapter implements IChatPort {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OpenAIChatConfig) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.model = config.model.trim();
  }

  complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<string> =>
        this.runStream(messages, context, apiKey, options),
    };
  }

  private async *runStream(
    messages: ChatMessage[],
    context: string,
    apiKey: string | undefined,
    options: ChatCompletionOptions | undefined,
  ): AsyncGenerator<string> {
    const { signal, dispose } = composeAbortSignal(options?.signal, options?.timeoutMs);
    const url = openAiUrl(this.baseUrl, '/chat/completions');
    const providerMessages = buildMessagesWithContext(messages, context);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey !== undefined && apiKey !== '') {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let usageReported = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: providerMessages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });

      if (!res.ok) {
        const raw = await res.text();
        console.warn('OpenAIChatAdapter: chat request failed', { status: res.status, url });
        throw new Error(`OpenAI chat HTTP ${res.status}: ${raw.slice(0, 200)}`);
      }

      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('text/event-stream')) {
        const raw = await res.text();
        try {
          const j = JSON.parse(raw) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };
          if (j.usage !== undefined) {
            options?.onUsage?.(
              normalizeProviderTokenUsage({
                promptTokens: j.usage.prompt_tokens,
                completionTokens: j.usage.completion_tokens,
                totalTokens: j.usage.total_tokens,
              }),
            );
            usageReported = true;
          }
          const text = j.choices?.[0]?.message?.content;
          if (text) yield text;
        } catch {
          /* ignore */
        }
        if (!usageReported) {
          options?.onUsage?.(unavailableProviderTokenUsage());
        }
        return;
      }

      const bodyReader = res.body?.getReader();
      if (!bodyReader) {
        throw new Error('OpenAI chat: missing response body');
      }
      reader = bodyReader;
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      while (!finished && !signal.aborted) {
        let chunk: Awaited<ReturnType<typeof readWithAbort>>;
        try {
          chunk = await readWithAbort(reader, signal);
        } catch {
          break;
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (t === '' || t.startsWith(':')) continue;
          if (t === 'data: [DONE]' || t.endsWith('[DONE]')) {
            finished = true;
            break;
          }
          if (!t.startsWith('data: ')) continue;
          const jsonStr = t.slice(6).trim();
          let parsed: {
            choices?: Array<{ delta?: { content?: string | null } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
          };
          try {
            parsed = JSON.parse(jsonStr) as typeof parsed;
          } catch {
            continue;
          }
          if (parsed.usage !== undefined && parsed.usage !== null && !usageReported) {
            options?.onUsage?.(
              normalizeProviderTokenUsage({
                promptTokens: parsed.usage.prompt_tokens,
                completionTokens: parsed.usage.completion_tokens,
                totalTokens: parsed.usage.total_tokens,
              }),
            );
            usageReported = true;
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        }
      }
      if (!usageReported) {
        options?.onUsage?.(unavailableProviderTokenUsage());
      }
    } finally {
      dispose();
      try {
        await reader?.cancel();
      } catch {
        /* best-effort */
      }
    }
  }
}
