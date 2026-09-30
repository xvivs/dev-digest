import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db, DbTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { CostMissingReason, CostSource, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * Derive WHY a run has no cost from its status — computed at read time, never
 * persisted (`cost_missing_reason` isn't a column). Keeps the three surfaces
 * (timeline, sidebar, PR list) from each reimplementing this mapping.
 */
function costMissingReason(status: string | null, costUsd: number | null): CostMissingReason | null {
  if (costUsd != null) return null;
  if (status === 'running' || status === 'queued') return 'pending';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'no_price';
}

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db | DbTx,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db | DbTx,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
    cost_usd: run.costUsd,
    cost_source: run.costSource,
    cost_missing_reason: costMissingReason(run.status, run.costUsd),
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db | DbTx,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** What a manual cancel needs to build the run's minimal trace. */
export interface RunCancelContext {
  status: string | null;
  provider: string | null;
  model: string | null;
  agentName: string | null;
  agentVersion: number | null;
  systemPrompt: string | null;
  prNumber: number | null;
}

export async function getRunCancelContext(db: Db | DbTx, runId: string): Promise<RunCancelContext | undefined> {
  const [row] = await db
    .select({
      status: t.agentRuns.status,
      provider: t.agentRuns.provider,
      model: t.agentRuns.model,
      agentName: t.agents.name,
      agentVersion: t.agents.version,
      systemPrompt: t.agents.systemPrompt,
      prNumber: t.pullRequests.number,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
    .where(eq(t.agentRuns.id, runId));
  return row;
}

/**
 * Mark a still-running run as cancelled (no-op if it already finished),
 * writing `trace` FIRST when the run has none yet — the trace-before-terminal
 * invariant every reader relies on (GET /runs/:id/trace must resolve once
 * the status is terminal). One transaction with the row locked, so a
 * concurrent executor write cannot interleave between the check and the
 * update. An existing trace (the executor got there first) is kept.
 */
export async function cancelRunWithTrace(db: Db | DbTx, runId: string, trace: RunTrace): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: t.agentRuns.status })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId))
      .for('update');
    if (row?.status !== 'running') return false;
    await tx.insert(t.runTraces).values({ runId, trace }).onConflictDoNothing({ target: t.runTraces.runId });
    await tx
      .update(t.agentRuns)
      .set({ status: 'cancelled', error: 'Cancelled by user' })
      .where(eq(t.agentRuns.id, runId));
    return true;
  });
}

/**
 * Lock the run row FOR UPDATE and return its current status (undefined when the
 * row is gone). Only meaningful inside a transaction: it serialises the
 * executor's terminal write against `cancelRunWithTrace`, which takes the same
 * lock — whichever commits second sees the other's status.
 */
export async function lockRunStatus(db: Db | DbTx, runId: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ status: t.agentRuns.status })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.id, runId))
    .for('update');
  return row ? row.status : undefined;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db | DbTx): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db | DbTx,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

export async function completeAgentRun(
  db: Db | DbTx,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
    /** Snapshot cost + provenance; null/null on failed/cancelled runs and on a
     *  done run whose model has no price entry. Never backfilled later. */
    costUsd?: number | null;
    costSource?: CostSource | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
      costUsd: values.costUsd ?? null,
      costSource: values.costSource ?? null,
    })
    // A manual cancel is final: the executor may still finish (its last LLM
    // call returned just before the abort) and must not flip `cancelled` back
    // to done/failed. Writing `cancelled` again only refines the counters.
    .where(
      and(
        eq(t.agentRuns.id, runId),
        values.status === 'cancelled' ? undefined : sql`${t.agentRuns.status} IS DISTINCT FROM 'cancelled'`,
      ),
    );
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db | DbTx, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db | DbTx, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}
