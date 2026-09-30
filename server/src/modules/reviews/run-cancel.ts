import type { Container } from '../../platform/container.js';
import type { ReviewRepository } from './repository.js';
import { failureTrace } from './failure-trace.js';

/** The atomic writes a manual cancel makes inside its transaction. */
export type CancelRunTx = Pick<ReviewRepository, 'lockRunStatus' | 'insertRunTraceIfAbsent' | 'markRunCancelled'>;

/** The persistence a manual cancel needs (a narrow port over ReviewRepository). */
export type CancelRunStore = Pick<ReviewRepository, 'getRunCancelContext'> & {
  transaction<T>(work: (tx: CancelRunTx) => Promise<T>): Promise<T>;
};

/** The run-bus surface a manual cancel touches. */
export type CancelRunBus = Pick<Container['runBus'], 'publish' | 'cancel' | 'buffer' | 'complete'>;

/**
 * Cancel an in-flight run. Signals a live runner to stop at its next
 * checkpoint AND marks the DB row cancelled + completes the bus immediately —
 * so cancel also works for ORPHANED runs (whose background process died on a
 * server restart) where signalling alone would do nothing.
 *
 * The status flips here, not when the executor notices, so an orphaned or
 * slow-to-stop run is cancelled at once — but a minimal trace (the log so far)
 * lands first. The executor's own cancel path later overwrites it with the
 * fuller one; its success path, locking the same row, discards its result.
 */
export async function cancelRun(store: CancelRunStore, bus: CancelRunBus, runId: string): Promise<void> {
  bus.publish(runId, 'info', 'Cancellation requested — stopping…');
  // Aborts the live executor's in-flight LLM request (closes the socket).
  bus.cancel(runId);
  const ctx = await store.getRunCancelContext(runId);
  if (ctx?.status === 'running') {
    const trace = failureTrace({
      agent: {
        name: ctx.agentName ?? 'unknown agent',
        version: ctx.agentVersion,
        provider: ctx.provider,
        model: ctx.model,
        systemPrompt: ctx.systemPrompt,
      },
      prNumber: ctx.prNumber,
      grounding: '0/0 passed',
      log: bus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    });
    // Trace (if absent) THEN status, in ONE transaction with the run row locked
    // FOR UPDATE — the trace-before-terminal invariant every reader relies on
    // (GET /runs/:id/trace must resolve once the status is terminal). The lock
    // serialises against the executor's terminal write (finishRun); an existing
    // trace (the executor got there first) is kept.
    await store.transaction(async (tx) => {
      if ((await tx.lockRunStatus(runId)) !== 'running') return;
      await tx.insertRunTraceIfAbsent(runId, trace);
      await tx.markRunCancelled(runId);
    });
  }
  bus.complete(runId);
}
