/**
 * The one run-status classifier (poll loop and `selectReview`). `RunSummary.status`
 * is a free string: `done` is success, `failed`/`cancelled` are terminal failures,
 * and `running`, null or any unknown value counts as still pending. Nothing
 * writes `queued` today.
 */
export type RunPhase = 'pending' | 'done' | 'failed';

export function runPhase(status: string | null): RunPhase {
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'pending';
}
