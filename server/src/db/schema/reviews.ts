import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

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
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
