import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
    /** Snapshot at completion; null on running/failed/cancelled runs and on
     *  done runs whose model has no price entry. Never backfilled. */
    costUsd: doublePrecision('cost_usd'),
    /** Provenance of costUsd — null iff costUsd is null (see cost.ts). */
    costSource: text('cost_source', { enum: ['provider', 'estimated'] }),
  },
  (t) => ({
    // Serves "the PR's latest run" (pulls list COST column + run history):
    // one PR's rows, newest first.
    prRanAtIdx: index('agent_runs_pr_ran_at_idx').on(t.prId, t.ranAt.desc()),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

/**
 * Which skills one run injected (plan Phase 2, Stats = Usage + Cost). A
 * relational copy of `run_traces.trace.prompt_assembly.skills_used`, written
 * best-effort next to `saveRunTrace` so stats aggregate with SQL instead of
 * scanning jsonb. Deleting a skill drops its rows (the trace keeps its copy).
 */
export const runSkills = pgTable(
  'run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    skillVersion: integer('skill_version').notNull(),
    /** sha256(body): same value as the trace's `skills_used.sha256`. */
    bodySha256: text('body_sha256').notNull(),
    /** ADR 0017 sha256(name + "\n" + body). Null only on backfilled rows whose
     *  body snapshot is gone or does not match `body_sha256`. */
    promptSha256: text('prompt_sha256'),
    /** chars/4 estimate of the skill body (reviewer-core `estimateTokens`). */
    tokens: integer('tokens').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.skillId] }),
    // The PK leads with run_id; stats and the skills list look up by skill.
    skillRunIdx: index('run_skills_skill_id_run_id_idx').on(t.skillId, t.runId),
  }),
);

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
