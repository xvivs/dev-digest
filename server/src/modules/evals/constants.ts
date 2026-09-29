/** Constants for the evals module (plan Phase 3). Thresholds live in domain.ts. */

/** `container.evalJobs` job kind: one (case, arm, repeat). */
export const EVAL_RUN_JOB_KIND = 'eval-run';

/** Concurrency of the dedicated eval runner (ADR 0018 §1). */
export const EVAL_JOBS_CONCURRENCY = 2;

/** `agent_runs.status` of a completed run (the plan's "completed"). */
export const COMPLETED_RUN_STATUS = 'done';

/** Error stored on runs a dead process left `running` (boot recovery). */
export const ORPHAN_RUN_ERROR = 'Interrupted: the server restarted while this run was in flight';

/** Error stored on runs that never started because the suite was cancelled. */
export const CANCELLED_RUN_ERROR = 'Suite cancelled';
