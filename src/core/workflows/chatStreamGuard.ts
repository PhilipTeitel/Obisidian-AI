import type { ChatCompletionOptions } from '../ports/IChatPort.js';

/**
 * Enforces `timeoutMs` and `AbortSignal` while consuming a chat delta stream (ADR-009).
 */
export async function* withChatCompletionControls(
  stream: AsyncIterable<string>,
  options?: ChatCompletionOptions,
): AsyncGenerator<string> {
  if (!options?.timeoutMs && !options?.signal) {
    for await (const d of stream) {
      yield d;
    }
    return;
  }

  const deadline =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? Date.now() + options.timeoutMs
      : null;
  const sig = options.signal;
  const iter = stream[Symbol.asyncIterator]();

  try {
    while (true) {
      if (sig?.aborted) {
        break;
      }
      const remaining = deadline !== null ? Math.max(0, deadline - Date.now()) : null;
      if (remaining !== null && remaining === 0) {
        break;
      }

      const nextP = iter.next();
      const racers: Promise<IteratorResult<string>>[] = [nextP];

      if (remaining !== null && remaining > 0) {
        racers.push(
          new Promise<IteratorResult<string>>((_, rej) => {
            setTimeout(() => rej(new Error('chat timeout')), remaining);
          }),
        );
      }

      if (sig) {
        if (sig.aborted) {
          break;
        }
        racers.push(
          new Promise<IteratorResult<string>>((_, rej) => {
            sig.addEventListener('abort', () => rej(sig.reason), { once: true });
          }),
        );
      }

      let result: IteratorResult<string>;
      try {
        result = await Promise.race(racers);
      } catch {
        break;
      }

      if (result.done) {
        break;
      }
      yield result.value;
    }
  } finally {
    // Do not await: if the source generator is suspended on a never-resolving `await`,
    // `return()` may not run until that promise settles (ADR-009 best-effort cancel).
    void iter.return?.();
  }
}
