/**
 * Poll `GET /pulls/:id/runs` until a run is terminal or the budget runs out (D9).
 * Time and sleep are injected so tests run without real timers.
 */
import type { DevDigestApi } from './api/client.js';
import { ApiError, isTransient } from './api/errors.js';
import type { RunLite } from './api/schemas.js';
import { toolErrors } from './errors.js';
import { runPhase } from './run-status.js';

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
export type Now = () => number;

/** Consecutive polls without the run before giving up with `run_not_found`. */
export const MISSING_POLLS_LIMIT = 3;

export interface WaitForRunOptions {
  api: DevDigestApi;
  prId: string;
  runId: string;
  timeoutMs: number;
  intervalMs: number;
  sleep: Sleep;
  now: Now;
  signal?: AbortSignal;
  /** Called once per poll with a strictly increasing count (1, 2, …). */
  onProgress?: (progress: number) => void | Promise<void>;
}

export type WaitOutcome =
  | { phase: 'done'; run: RunLite }
  /** Still pending when the budget ran out (or the request was aborted). */
  | { phase: 'running'; run: RunLite | null };

/** Real sleep that resolves early when `signal` aborts. */
export const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * Throws `run_failed` for a failed/cancelled run and `run_not_found` when the
 * run is missing from the list for MISSING_POLLS_LIMIT polls in a row. A
 * transient API error (unreachable, timeout, 429, 5xx) waits and polls again;
 * if the last poll before the deadline failed, that error is rethrown.
 */
export async function waitForRun(o: WaitForRunOptions): Promise<WaitOutcome> {
  const deadline = o.now() + o.timeoutMs;
  let polls = 0;
  let missing = 0;
  let lastRun: RunLite | null = null;

  for (;;) {
    if (o.signal?.aborted) return { phase: 'running', run: lastRun };

    let waitMs = o.intervalMs;
    let lastError: unknown = null;
    let runs: RunLite[] | null = null;
    try {
      runs = await o.api.listRuns(o.prId, o.signal);
    } catch (e) {
      // An abort cancels the in-flight request too; stop without another call.
      if (o.signal?.aborted) return { phase: 'running', run: lastRun };
      if (!isTransient(e)) throw e;
      lastError = e;
      if (e instanceof ApiError && e.retryAfterSec !== null) {
        waitMs = Math.max(o.intervalMs, e.retryAfterSec * 1000);
      }
    }

    polls += 1;
    await o.onProgress?.(polls);

    if (runs !== null) {
      const run = runs.find((r) => r.run_id === o.runId);
      if (!run) {
        missing += 1;
        if (missing >= MISSING_POLLS_LIMIT) throw toolErrors.runNotFound(o.runId);
      } else {
        missing = 0;
        lastRun = run;
        const phase = runPhase(run.status);
        if (phase === 'done') return { phase: 'done', run };
        if (phase === 'failed') throw toolErrors.runFailed(o.runId, run.status ?? 'failed', run.error);
      }
    }

    const remaining = deadline - o.now();
    if (remaining <= 0) {
      if (lastError !== null) throw lastError;
      return { phase: 'running', run: lastRun };
    }
    await o.sleep(Math.min(waitMs, remaining), o.signal);
  }
}
