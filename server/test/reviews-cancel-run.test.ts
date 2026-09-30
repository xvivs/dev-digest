/**
 * Hermetic: manual cancel (`cancelRun`, behind ReviewService.cancelRun) over an
 * in-memory store fake and a real, process-local RunBus. No DB.
 */
import { describe, it, expect } from 'vitest';
import type { RunTrace } from '@devdigest/shared';
import { RunBus } from '../src/platform/sse.js';
import { cancelRun, type CancelRunStore } from '../src/modules/reviews/run-cancel.js';
import type { RunCancelContext } from '../src/modules/reviews/repository/run.repo.js';

function fakeStore(ctx: RunCancelContext | undefined) {
  const writes: { runId: string; trace: RunTrace }[] = [];
  const store: CancelRunStore = {
    async getRunCancelContext() {
      return ctx;
    },
    async cancelRunWithTrace(runId, trace) {
      writes.push({ runId, trace });
      return true;
    },
  };
  return { store, writes };
}

const running: RunCancelContext = {
  status: 'running',
  provider: 'openai',
  model: 'gpt-4.1',
  agentName: 'sec',
  agentVersion: 2,
  systemPrompt: 'Review.',
  prNumber: 7,
};

describe('cancelRun', () => {
  it('aborts the live signal, writes a trace carrying the log so far, and completes the bus', async () => {
    const bus = new RunBus();
    const signal = bus.signal('r1');
    bus.publish('r1', 'info', 'Reviewing all files in one pass');
    const { store, writes } = fakeStore(running);

    await cancelRun(store, bus, 'r1');

    expect(signal.aborted).toBe(true);
    expect(bus.isCancelled('r1')).toBe(true);
    expect(bus.isComplete('r1')).toBe(true);
    expect(writes).toHaveLength(1);
    const { runId, trace } = writes[0]!;
    expect(runId).toBe('r1');
    expect(trace.config).toMatchObject({ agent: 'sec', version: '2', model: 'gpt-4.1', pr: 7 });
    expect(trace.stats.cost_missing_reason).toBe('failed');
    // The "requested" notice is published before the buffer is snapshotted.
    expect(trace.log.map((l) => l.msg)).toEqual([
      'Reviewing all files in one pass',
      'Cancellation requested — stopping…',
    ]);
  });

  it('falls back to a placeholder agent name for an agent-less (deleted agent) run', async () => {
    const { store, writes } = fakeStore({ ...running, agentName: null, agentVersion: null });
    await cancelRun(store, new RunBus(), 'r2');
    expect(writes[0]?.trace.config.agent).toBe('unknown agent');
    expect(writes[0]?.trace.config.version).toBeNull();
  });

  it.each([
    ['already finished', { ...running, status: 'done' }],
    ['already cancelled', { ...running, status: 'cancelled' }],
    ['unknown run', undefined],
  ] as const)('%s: no DB write, but the bus is still signalled and completed', async (_label, ctx) => {
    const bus = new RunBus();
    const { store, writes } = fakeStore(ctx);
    await cancelRun(store, bus, 'r3');
    expect(writes).toEqual([]);
    expect(bus.isCancelled('r3')).toBe(true);
    expect(bus.isComplete('r3')).toBe(true);
  });
});
