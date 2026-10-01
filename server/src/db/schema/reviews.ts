import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  index,
  check,
} from 'drizzle-orm/pg-core';
import type {
  BlastRadius,
  BlastReason,
  IntentSource,
  PrHistoryItem,
  Risk,
  UnresolvedLink,
} from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { repoIndexState } from './repo-intel';

/**
 * Mirrors the shared `BlastReason` enum. drizzle-kit loads this file as CJS and
 * cannot resolve the shared runtime, so the list is spelled out here; the
 * checks below fail typecheck if the two ever drift.
 */
const BLAST_REASONS = [
  'index_partial',
  'no_index',
  'flag_off',
  'no_changed_files',
  'index_failed',
  'repo_too_large',
  'no_data',
] as const satisfies readonly BlastReason[];
type AssertAllBlastReasons = Exclude<BlastReason, (typeof BLAST_REASONS)[number]> extends never ? true : never;
const _allBlastReasons: AssertAllBlastReasons = true;
void _allBlastReasons;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const INTENT_CONFIDENCES = ['high', 'medium', 'low'] as const;
const COST_SOURCES = ['provider', 'estimated'] as const;
const BLAST_STATUSES = ['ok', 'degraded'] as const;

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // Serves "the PR's latest review" — the anchor for the pulls list's SCORE +
    // FINDINGS columns and for the per-PR review history. `pr_id` also carries
    // the FK: without an index here every cascade delete of a PR seq-scanned
    // this table.
    //
    // `created_at` drops the Sort only on the single-PR path (`pr_id = ?
    // ORDER BY created_at DESC` → a plain index scan). The pulls list uses
    // `pr_id IN (…)`, and PG16 cannot return ordered rows through a
    // ScalarArrayOp scan, so that query keeps its Sort node whatever we index.
    // `.desc()` is for symmetry with `agent_runs_pr_ran_at_idx` and to document
    // the access path — measured identical to ascending, which PG just reads
    // backwards.
    prCreatedIdx: index('reviews_pr_created_idx').on(t.prId, t.createdAt.desc()),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // Covers the pulls list's `GROUP BY review_id, severity` tally: both
    // grouped columns sit in the index, so a fresh visibility map gives an
    // index-only scan + GroupAggregate with no Sort (~2x the single-column
    // `(review_id)` index). Accept/dismiss writes to `accepted_at` /
    // `dismissed_at` stale the visibility map, and the plan then falls back to
    // a bitmap heap scan — i.e. to exactly what `(review_id)` alone would give,
    // never worse, and autovacuum earns the index-only scan back.
    //
    // By leftmost prefix it also serves plain `WHERE review_id = …` (the
    // findings panel) and the `ON DELETE CASCADE` FK check, which before this
    // index seq-scanned the whole table on every review delete.
    reviewSeverityIdx: index('findings_review_severity_idx').on(t.reviewId, t.severity),
  }),
);

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** The persisted pull_requests.head_sha the intent was derived for (freshness key). */
  headSha: text('head_sha'),
  confidence: text('confidence', { enum: INTENT_CONFIDENCES })
    .notNull()
    .default('low'),
  sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
  unresolvedLinks: jsonb('unresolved_links')
    .$type<UnresolvedLink[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  provider: text('provider'),
  model: text('model'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** costUsd + costSource are a pair: both null or both set (ADR 0002). */
  costUsd: doublePrecision('cost_usd'),
  costSource: text('cost_source', { enum: COST_SOURCES }),
  derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => ({
    costPairCheck: check('pr_intent_cost_pair_check', sql`(${t.costUsd} IS NULL) = (${t.costSource} IS NULL)`),
    costSourceCheck: check(
      'pr_intent_cost_source_check',
      sql`${t.costSource} IS NULL OR ${t.costSource} IN (${inList(COST_SOURCES)})`,
    ),
    confidenceCheck: check('pr_intent_confidence_check', sql`${t.confidence} IN (${inList(INTENT_CONFIDENCES)})`),
  }),
);

export const prRisks = pgTable('pr_risks', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  headSha: text('head_sha').notNull(),
  risks: jsonb('risks').$type<Risk[]>().notNull(),
  droppedRefs: integer('dropped_refs').notNull().default(0),
  /** True when the LLM call failed and only the deterministic rule risks were stored. */
  ruleOnly: boolean('rule_only').notNull().default(false),
  provider: text('provider'),
  model: text('model'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** costUsd + costSource are a pair: both null or both set (ADR 0002). */
  costUsd: doublePrecision('cost_usd'),
  costSource: text('cost_source', { enum: COST_SOURCES }),
  derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => ({
    costPairCheck: check('pr_risks_cost_pair_check', sql`(${t.costUsd} IS NULL) = (${t.costSource} IS NULL)`),
    costSourceCheck: check(
      'pr_risks_cost_source_check',
      sql`${t.costSource} IS NULL OR ${t.costSource} IN (${inList(COST_SOURCES)})`,
    ),
  }),
);

export const prBlastCache = pgTable('pr_blast_cache', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  headSha: text('head_sha').notNull(),
  /** Index's last_indexed_sha when full/partial; else the clone's current head, or '' with no clone. */
  sourceSha: text('source_sha').notNull(),
  indexerVersion: integer('indexer_version').notNull(),
  indexStatus: text('index_status', { enum: repoIndexState.status.enumValues }).notNull(),
  repoIntelEnabled: boolean('repo_intel_enabled').notNull(),
  status: text('status', { enum: BLAST_STATUSES }).notNull(),
  reason: text('reason', { enum: BLAST_REASONS }),
  blast: jsonb('blast').$type<BlastRadius>().notNull(),
  truncated: boolean('truncated').notNull().default(false),
  /** Bumped (BLAST_MAPPING_VERSION) when the status/reason/order mapping changes; older rows are stale. */
  mappingVersion: integer('mapping_version').notNull().default(0),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => ({
    statusCheck: check('pr_blast_cache_status_check', sql`${t.status} IN (${inList(BLAST_STATUSES)})`),
    reasonCheck: check(
      'pr_blast_cache_reason_check',
      sql`${t.reason} IS NULL OR ${t.reason} IN (${inList(BLAST_REASONS)})`,
    ),
    indexStatusCheck: check(
      'pr_blast_cache_index_status_check',
      sql`${t.indexStatus} IN (${inList(repoIndexState.status.enumValues)})`,
    ),
  }),
);

export const prHistoryCache = pgTable('pr_history_cache', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  headSha: text('head_sha').notNull(),
  base: text('base').notNull(),
  /** sha256 of the sorted queried paths. */
  pathsHash: text('paths_hash').notNull(),
  history: jsonb('history').$type<PrHistoryItem[]>().notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
