type ReaderResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;

/**
 * `fetch` abort does not always reject a pending `ReadableStreamDefaultReader.read()`
 * when the underlying pull never settles. Race with `signal` and `cancel()` the reader.
 */
export async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReaderResult> {
  if (signal.aborted) {
    return { done: true, value: undefined } as ReaderResult;
  }
  return await new Promise<ReaderResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const onAbort = (): void => {
      void reader
        .cancel()
        .catch(() => {})
        .finally(() => {
          finish(() => resolve({ done: true, value: undefined }));
        });
    };

    signal.addEventListener('abort', onAbort);

    reader
      .read()
      .then((r) => {
        finish(() => resolve(r));
      })
      .catch((e: unknown) => {
        finish(() => reject(e));
      });
  });
}
