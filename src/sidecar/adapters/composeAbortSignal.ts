/**
 * Combine optional caller abort with a wall-clock timeout (ADR-009). Node >= 18.
 * Always call `dispose()` when the request completes (success, error, or abort).
 */
export function composeAbortSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal; dispose: () => void } {
  const composed = new AbortController();
  const disposers: Array<() => void> = [];

  const abort = (): void => {
    composed.abort();
  };

  if (userSignal) {
    if (userSignal.aborted) {
      abort();
      return {
        signal: composed.signal,
        dispose: () => {},
      };
    }
    const onAbort = (): void => {
      abort();
    };
    userSignal.addEventListener('abort', onAbort);
    disposers.push(() => userSignal.removeEventListener('abort', onAbort));
  }

  let tid: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    tid = setTimeout(abort, timeoutMs);
    disposers.push(() => {
      if (tid !== undefined) clearTimeout(tid);
    });
  }

  const dispose = (): void => {
    for (const d of disposers) d();
  };

  composed.signal.addEventListener('abort', dispose, { once: true });

  return { signal: composed.signal, dispose };
}
