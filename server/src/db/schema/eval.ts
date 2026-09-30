import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Eval / Conformance / Compose

/** One list per column for the Drizzle enum type AND the DB CHECK, so they can't drift. */
const EVAL_SUITE_MODES = ['quick', 'full'] as const;
const EVAL_SUITE_STATUSES = ['estimated', 'running', 'done', 'failed', 'cancelled'] as const;
const EVAL_ARMS = ['with', 'without'] as const;
const EVAL_RUN_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
const COST_SOURCES = ['provider', 'estimated'] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const evalCases = pgTable(
  'eval_cases',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  /**
   * Plan Phase 3 [R9]: the owning skill as a real FK (owner_id is polymorphic
   * and cannot carry one). Set iff owner_kind='skill'.
   */
  skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Unified diff snapshot: a later PR update never changes the case. */
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  /** Provenance (`EvalCaseSourceMeta`): paste, or PR id/number/head sha/files. */
  inputMeta: jsonb('input_meta'),
  /**
   * `EvalExpectation` for skill cases. Stays `unknown` at the column level:
   * legacy rows may hold any shape, so reads parse tolerantly (null on failure).
   */
  expectedOutput: jsonb('expected_output').$type<unknown>(),
  notes: text('notes'),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skillIdx: index('eval_cases_skill_id_idx').on(t.skillId),
    // owner_kind='skill' => skill_id = owner_id (and set); agent cases carry none.
    skillOwnerCheck: check(
      'eval_cases_skill_owner_check',
      sql`CASE WHEN ${t.ownerKind} = 'skill' THEN ${t.skillId} IS NOT NULL AND ${t.skillId} = ${t.ownerId} ELSE ${t.skillId} IS NULL END`,
    ),
  }),
);

/**
 * One ablation eval of a skill on a carrier agent (ADR 0017/0018). Created in
 * `estimated`, started once by a guarded UPDATE, closed by the atomic
 * `done_jobs` counter. `carrier_agent_id` carries no FK on purpose: the suite
 * (and the verdict history) outlives a deleted agent; `carrier_agent_name` is
 * the name at creation, the fallback label once the agent is gone.
 */
export const evalSuites = pgTable(
  'eval_suites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    skillVersion: integer('skill_version').notNull(),
    /** sha256(name + "\n" + body) of the target version: the stale key. */
    promptSha256: text('prompt_sha256').notNull(),
    carrierAgentId: uuid('carrier_agent_id').notNull(),
    carrierAgentVersion: integer('carrier_agent_version').notNull(),
    carrierAgentName: text('carrier_agent_name').notNull(),
    /** Always the carrier's model (plan decision #8). */
    model: text('model').notNull(),
    /**
     * Frozen at creation so every job of the suite sees the same prompt:
     * carrier provider, system prompt, strategy and the ordered `with` skills
     * (target included). `without` = the same list minus the target.
     */
    runConfig: jsonb('run_config').notNull(),
    mode: text('mode', { enum: EVAL_SUITE_MODES }).notNull(),
    repeats: integer('repeats').notNull(),
    status: text('status', { enum: EVAL_SUITE_STATUSES }).notNull().default('estimated'),
    totalJobs: integer('total_jobs').notNull(),
    doneJobs: integer('done_jobs').notNull().default(0),
    estimateUsd: doublePrecision('estimate_usd').notNull(),
    costUsd: doublePrecision('cost_usd'),
    costSource: text('cost_source', { enum: COST_SOURCES }),
    /** `EvalSuiteResults`, written once when the suite closes. */
    results: jsonb('results'),
    error: text('error'),
    /**
     * Cases a per-case suite covers; NULL = the skill's whole runnable case set.
     * A suite with this set is "partial": never the Impact / latest-verdict
     * source (ADR 0017: a verdict needs the full case set). No FK: an array
     * cannot carry one, and a deleted case just leaves a dead id here.
     */
    caseIds: uuid('case_ids').array(),
    createdAt: now(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    skillCreatedIdx: index('eval_suites_skill_created_idx').on(t.skillId, t.createdAt.desc()),
    // ADR 0018: one running suite per workspace, enforced by the database so
    // two concurrent starts cannot both win.
    oneRunningUq: uniqueIndex('eval_suites_one_running_per_workspace_uq')
      .on(t.workspaceId)
      .where(sql`${t.status} = 'running'`),
    modeCheck: check('eval_suites_mode_check', sql`${t.mode} IN (${inList(EVAL_SUITE_MODES)})`),
    statusCheck: check('eval_suites_status_check', sql`${t.status} IN (${inList(EVAL_SUITE_STATUSES)})`),
    costSourceCheck: check(
      'eval_suites_cost_source_check',
      sql`${t.costSource} IS NULL OR ${t.costSource} IN (${inList(COST_SOURCES)})`,
    ),
    costPairCheck: check('eval_suites_cost_pair_check', sql`(${t.costUsd} IS NULL) = (${t.costSource} IS NULL)`),
    jobsCheck: check(
      'eval_suites_jobs_check',
      sql`${t.doneJobs} >= 0 AND ${t.totalJobs} >= 0 AND ${t.repeats} > 0`,
    ),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    /** @deprecated legacy L06 metric; skill ablation evals never write it. */
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    // ---- ablation job columns (ADR 0018). Nullable so legacy rows migrate.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    suiteId: uuid('suite_id').references(() => evalSuites.id, { onDelete: 'cascade' }),
    arm: text('arm', { enum: EVAL_ARMS }),
    repeatIdx: integer('repeat_idx'),
    status: text('status', { enum: EVAL_RUN_STATUSES }),
    error: text('error'),
    matched: integer('matched'),
    expected: integer('expected'),
    unexpected: integer('unexpected'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costSource: text('cost_source', { enum: COST_SOURCES }),
  },
  (t) => ({
    // Idempotency key of one job: a retry or a late result can never add a row.
    jobUq: uniqueIndex('eval_runs_suite_case_arm_repeat_uq').on(t.suiteId, t.caseId, t.arm, t.repeatIdx),
    // Boot recovery scans by status; the FK column needs its own index anyway.
    suiteStatusIdx: index('eval_runs_suite_status_idx').on(t.suiteId, t.status),
    caseIdx: index('eval_runs_case_id_idx').on(t.caseId),
    armCheck: check('eval_runs_arm_check', sql`${t.arm} IS NULL OR ${t.arm} IN (${inList(EVAL_ARMS)})`),
    statusCheck: check(
      'eval_runs_status_check',
      sql`${t.status} IS NULL OR ${t.status} IN (${inList(EVAL_RUN_STATUSES)})`,
    ),
    costPairCheck: check('eval_runs_cost_pair_check', sql`(${t.costUsd} IS NULL) = (${t.costSource} IS NULL)`),
    costSourceCheck: check(
      'eval_runs_cost_source_check',
      sql`${t.costSource} IS NULL OR ${t.costSource} IN (${inList(COST_SOURCES)})`,
    ),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
