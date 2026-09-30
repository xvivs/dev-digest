/**
 * Retry for transient LLM transport failures (429 / 5xx / connection resets)
 * that respects the caller's `signal` and remaining deadline.
 *
 * Used instead of SDK retries whenever a request carries `signal`/`timeoutMs`
 * (SDK retries are then 0 — see request-options.ts): the SDK's retry loop knows
 * nothing about the caller's deadline and would outlive it.
 *
 * Only the transport call is wrapped — schema validation (repair loop),
 * `finish_reason: length` and aborts never reach `isTransientLlmError` as
 * retryable.
 */
import { throwIfAborted } from './request-options.js';

export interface TransientRetryOptions {
  /** Aborts the retry loop and any backoff sleep (rejects with AbortError). */
  signal?: AbortSignal;
  /** Absolute epoch ms; a retry whose backoff would end past it is not attempted. */
  deadlineAt?: number;
  /** Extra attempts after the first (default 2). */
  retries?: number;
  /** First backoff (default 500 ms); each next one is ×3 (500 → 1500). */
  baseDelayMs?: number;
  /** Upper bound for a single backoff, including Retry-After (default 30 s). */
  maxDelayMs?: number;
  /** Jitter source in [0, 1); adds up to +20% to the computed backoff. */
  random?: () => number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET']);

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/** 429 / ≥500, or a network error code anywhere in the `cause` chain. */
export function isTransientLlmError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur != null; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_CODES.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (headers == null || typeof headers !== 'object') return undefined;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const v: unknown = get.call(headers, name);
    return typeof v === 'string' ? v : undefined;
  }
  const v = (headers as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : undefined;
}

/** `retry-after-ms`, or `Retry-After` as seconds or an HTTP date; ms or undefined. */
export function retryAfterMs(err: unknown, now: number = Date.now()): number | undefined {
  const headers = (err as { headers?: unknown })?.headers;
  const rawMs = readHeader(headers, 'retry-after-ms');
  if (rawMs !== undefined && rawMs.trim() !== '') {
    const ms = Number(rawMs);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  const raw = readHeader(headers, 'retry-after');
  if (raw === undefined || raw.trim() === '') return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : undefined;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** setTimeout that rejects with AbortError (and clears itself) when the signal fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withTransientRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: TransientRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 30_000;
  const random = opts.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    throwIfAborted(opts.signal);
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || opts.signal?.aborted || !isTransientLlmError(err)) throw err;
      const now = Date.now();
      const backoff = base * 3 ** attempt;
      const delay = Math.min(max, retryAfterMs(err, now) ?? backoff + random() * 0.2 * backoff);
      // Not enough budget left to wait and still get an answer: surface the original error.
      if (opts.deadlineAt !== undefined && opts.deadlineAt - now <= delay) throw err;
      opts.onRetry?.(attempt + 1, delay, err);
      await abortableSleep(delay, opts.signal);
    }
  }
}

/** Absolute deadline for a call that owns `timeoutMs` from `start` (undefined when unset). */
export function deadlineFrom(timeoutMs: number | undefined, start: number = Date.now()): number | undefined {
  return timeoutMs === undefined ? undefined : start + timeoutMs;
}
