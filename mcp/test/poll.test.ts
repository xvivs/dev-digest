import { describe, expect, it } from 'vitest';
import type { RunLite } from '../src/api/schemas.js';
import { ApiError } from '../src/api/errors.js';
import { ToolError } from '../src/errors.js';
import { waitForRun, type WaitForRunOptions } from '../src/poll.js';
import { FakeApi } from './fake-api.js';
import { PR_ID, RUN_ID } from './fixtures.js';

function run(status: string | null, overrides: Partial<RunLite> = {}): RunLite {
  return {
    run_id: RUN_ID,
    agent_id: 'a',
    agent_name: 'A',
    status,
    error: null,
    duration_ms: status === 'done' ? 1000 : null,
    findings_count: status === 'done' ? 1 : null,
    cost_usd: null,
    ran_at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function httpError(status: number, retryAfterSec: number | null = null) {
  return new ApiError({
    kind: 'http',
    status,
    message: 'x',
    baseUrl: 'http://h',
    endpoint: 'GET /pulls/:id/runs',
    timeoutMs: 1,
    retryAfterSec,
  });
}

/** A virtual clock: sleep advances `now`, and every sleep is recorded. */
function harness(script: Array<RunLite[] | Error>, overrides: Partial<WaitForRunOptions> = {}) {
  const api = new FakeApi();
  let t = 0;
  const sleeps: number[] = [];
  let i = 0;
  api.runs = () => {
    const step = script[Math.min(i, script.length - 1)]!;
    i += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  const progress: number[] = [];
  const opts: WaitForRunOptions = {
    api,
    prId: PR_ID,
    runId: RUN_ID,
    timeoutMs: 10_000,
    intervalMs: 1_000,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    onProgress: (p) => {
      progress.push(p);
    },
    ...overrides,
  };
  return { api, opts, sleeps, progress };
}

async function toolError(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError);
    return e as ToolError;
  }
  throw new Error('expected a ToolError');
}

describe('waitForRun (D9)', () => {
  it('polls running → done', async () => {
    const h = harness([[run('running')], [run(null)], [run('done')]]);
    const out = await waitForRun(h.opts);
    expect(out.phase).toBe('done');
    expect(h.api.callsTo('listRuns')).toHaveLength(3);
    expect(h.sleeps).toEqual([1_000, 1_000]);
  });

  it('throws run_failed carrying the run error', async () => {
    const h = harness([[run('running')], [run('failed', { error: 'LLM key invalid' })]]);
    const e = await toolError(waitForRun(h.opts));
    expect(e.kind).toBe('run_failed');
    expect(e.message).toContain('"LLM key invalid"');
    expect(e.message).toContain('failed');
  });

  it('treats cancelled as run_failed', async () => {
    const h = harness([[run('cancelled')]]);
    const e = await toolError(waitForRun(h.opts));
    expect(e.kind).toBe('run_failed');
    expect(e.message).toContain('cancelled');
    expect(e.message).toContain('none recorded');
  });

  it('returns running when the budget runs out (AC-11)', async () => {
    const h = harness([[run('running')]], { timeoutMs: 2_500 });
    const out = await waitForRun(h.opts);
    expect(out).toMatchObject({ phase: 'running', run: { run_id: RUN_ID } });
    expect(h.api.callsTo('listRuns').length).toBe(4); // t = 0, 1000, 2000, 2500
  });

  it('reports progress once per poll, strictly increasing (AC-12)', async () => {
    const h = harness([[run('running')], [run('running')], [run('done')]]);
    await waitForRun(h.opts);
    expect(h.progress).toEqual([1, 2, 3]);
  });

  it('keeps polling through a 429 and a 503, honouring retry-after (AC-14)', async () => {
    const h = harness([httpError(429, 7), httpError(503), [run('done')]]);
    const out = await waitForRun(h.opts);
    expect(out.phase).toBe('done');
    expect(h.sleeps).toEqual([7_000, 1_000]);
  });

  it('never waits less than one interval, even with retry-after: 0', async () => {
    const h = harness([httpError(429, 0), [run('done')]]);
    await waitForRun(h.opts);
    expect(h.sleeps).toEqual([1_000]);
  });

  it('keeps polling while the API is unreachable, and rethrows if the last poll failed', async () => {
    const unreachable = new ApiError({
      kind: 'unreachable',
      message: 'fetch failed',
      baseUrl: 'http://h',
      endpoint: 'GET /pulls/:id/runs',
      timeoutMs: 1,
    });
    const h = harness([unreachable], { timeoutMs: 2_000 });
    await expect(waitForRun(h.opts)).rejects.toBe(unreachable);
    expect(h.api.callsTo('listRuns').length).toBe(3);
  });

  it('does not retry a non-transient API error', async () => {
    const h = harness([httpError(404)]);
    await expect(waitForRun(h.opts)).rejects.toBeInstanceOf(ApiError);
    expect(h.api.callsTo('listRuns')).toHaveLength(1);
  });

  it('gives run_not_found after the run is missing for 3 polls in a row', async () => {
    const h = harness([[]]);
    const e = await toolError(waitForRun(h.opts));
    expect(e.kind).toBe('run_not_found');
    expect(h.api.callsTo('listRuns')).toHaveLength(3);
  });

  it('resets the missing counter when the run reappears', async () => {
    const h = harness([[], [], [run('running')], [], [], [run('done')]]);
    await expect(waitForRun(h.opts)).resolves.toMatchObject({ phase: 'done' });
  });

  it('an abort during an in-flight listRuns resolves promptly (AC-13)', async () => {
    const controller = new AbortController();
    const h = harness([[run('running')]], { signal: controller.signal });
    h.api.runs = (signal) =>
      new Promise<RunLite[]>((_resolve, reject) => {
        // Never answers on its own: only the threaded abort signal ends it.
        signal?.addEventListener('abort', () => reject(signal.reason));
        setTimeout(() => controller.abort(), 0);
      });
    const out = await waitForRun(h.opts);
    expect(out.phase).toBe('running');
    expect(h.api.callsTo('listRuns')).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('stops on an aborted signal with no further listRuns call (AC-13)', async () => {
    const controller = new AbortController();
    const h = harness([[run('running')]]);
    h.opts.signal = controller.signal;
    h.opts.sleep = async () => {
      controller.abort();
    };
    const out = await waitForRun(h.opts);
    expect(out.phase).toBe('running');
    expect(h.api.callsTo('listRuns')).toHaveLength(1);
  });
});
