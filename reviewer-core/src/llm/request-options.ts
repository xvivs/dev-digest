/**
 * Per-request SDK options for the OpenAI / Anthropic clients (both accept
 * `{ timeout, maxRetries, signal }` as the second argument of `create`).
 * Returns undefined when the caller set neither `timeoutMs` nor `signal`, so
 * the client's constructor defaults (timeout, retries) stay in force.
 * When set, SDK retries are off: the caller owns the deadline, and a retry
 * would outlive it.
 */
export interface SdkRequestOptions {
  timeout?: number;
  maxRetries: 0;
  signal?: AbortSignal;
}

export function sdkRequestOptions(req: {
  timeoutMs?: number;
  signal?: AbortSignal;
}): SdkRequestOptions | undefined {
  if (req.timeoutMs === undefined && req.signal === undefined) return undefined;
  return {
    ...(req.timeoutMs !== undefined ? { timeout: req.timeoutMs } : {}),
    maxRetries: 0,
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  };
}

/** Throw an `AbortError` if the signal has already fired (checked before every attempt). */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}
