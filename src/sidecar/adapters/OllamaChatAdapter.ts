import type { ChatMessage } from '../../core/domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '../../core/ports/IChatPort.js';
import { buildMessagesWithContext } from './chatProviderMessages.js';
import { composeAbortSignal } from './composeAbortSignal.js';
import { readWithAbort } from './readWithAbort.js';

export interface OllamaChatConfig {
  baseUrl: string;
  model: string;
}

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function ollamaChatUrl(baseUrl: string): string {
  return `${trimBaseUrl(baseUrl)}/api/chat`;
}

export class OllamaChatAdapter implements IChatPort {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OllamaChatConfig) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.model = config.model.trim();
  }

  complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string> {
    void apiKey;
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<string> =>
        this.runStream(messages, context, options),
    };
  }

  private async *runStream(
    messages: ChatMessage[],
    context: string,
    options: ChatCompletionOptions | undefined,
  ): AsyncGenerator<string> {
    const { signal, dispose } = composeAbortSignal(options?.signal, options?.timeoutMs);
    const url = ollamaChatUrl(this.baseUrl);
    const providerMessages = buildMessagesWithContext(messages, context);

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: providerMessages,
          stream: true,
        }),
        signal,
      });

      if (!res.ok) {
        const raw = await res.text();
        console.warn('OllamaChatAdapter: chat request failed', { status: res.status, url });
        throw new Error(`Ollama chat HTTP ${res.status}: ${raw.slice(0, 200)}`);
      }

      const bodyReader = res.body?.getReader();
      if (!bodyReader) {
        throw new Error('Ollama chat: missing response body');
      }
      reader = bodyReader;
      const decoder = new TextDecoder();
      let buffer = '';
      /** Ollama may send cumulative `message.content`; emit only new suffix. */
      let contentPrefix = '';

      while (!signal.aborted) {
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
          if (!t) continue;
          let parsed: { message?: { content?: string }; done?: boolean };
          try {
            parsed = JSON.parse(t) as { message?: { content?: string }; done?: boolean };
          } catch {
            continue;
          }
          const c = parsed.message?.content;
          if (typeof c !== 'string' || c.length === 0) continue;
          if (c.startsWith(contentPrefix)) {
            const delta = c.slice(contentPrefix.length);
            contentPrefix = c;
            if (delta) yield delta;
          } else {
            yield c;
            contentPrefix = c;
          }
        }
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
