import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  vector,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

// ============================================================ Conventions extractor

/** One list per column for the Drizzle enum type AND the DB CHECK, so they can't drift. */
const SCAN_STATUSES = ['running', 'done', 'failed'] as const;
const COST_SOURCES = ['provider', 'estimated'] as const;
const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error-handling',
  'async',
  'typing',
  'testing',
  'imports',
  'api',
  'other',
] as const;
const CONVENTION_ORIGINS = ['code', 'review_history'] as const;
const CONVENTION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    status: text('status', { enum: SCAN_STATUSES }).notNull(),
    jobId: text('job_id'),
    attempt: integer('attempt').notNull().default(0),
    commitSha: text('commit_sha'),
    sampleFileCount: integer('sample_file_count').notNull().default(0),
    foundCount: integer('found_count').notNull().default(0),
    verifiedCount: integer('verified_count').notNull().default(0),
    droppedCount: integer('dropped_count').notNull().default(0),
    relocatedCount: integer('relocated_count').notNull().default(0),
    matchedPriorCount: integer('matched_prior_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    costSource: text('cost_source', { enum: COST_SOURCES }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    wsIdx: index('convention_scans_ws_idx').on(t.workspaceId),
    repoStartedIdx: index('convention_scans_repo_started_idx').on(t.repoId, sql`${t.startedAt} DESC`),
    // At most one running scan per repo; a concurrent insert fails with 23505 (-> 409).
    runningUq: uniqueIndex('convention_scans_repo_running_uq')
      .on(t.repoId)
      .where(sql`${t.status} = 'running'`),
    statusCheck: check('convention_scans_status_check', sql`${t.status} IN (${inList(SCAN_STATUSES)})`),
    costSourceCheck: check(
      'convention_scans_cost_source_check',
      sql`${t.costSource} IS NULL OR ${t.costSource} IN (${inList(COST_SOURCES)})`,
    ),
  }),
);

/** Stable identity of a rule per repo; decisions (status, edits) live here, not on scan rows. */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    category: text('category', { enum: CONVENTION_CATEGORIES }).notNull(),
    origin: text('origin', { enum: CONVENTION_ORIGINS }).notNull(),
    rule: text('rule').notNull(),
    originalRule: text('original_rule').notNull(),
    status: text('status', { enum: CONVENTION_STATUSES }).notNull().default('pending'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: now(),
    // SET NULL: retention may delete an old scan; the identity and its decision stay.
    lastSeenScanId: uuid('last_seen_scan_id').references(() => conventionScans.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    repoFingerprintUq: uniqueIndex('conventions_repo_fingerprint_uq').on(t.repoId, t.fingerprint),
    wsIdx: index('conventions_ws_idx').on(t.workspaceId),
    lastSeenScanIdx: index('conventions_last_seen_scan_idx').on(t.lastSeenScanId),
    categoryCheck: check('conventions_category_check', sql`${t.category} IN (${inList(CONVENTION_CATEGORIES)})`),
    originCheck: check('conventions_origin_check', sql`${t.origin} IN (${inList(CONVENTION_ORIGINS)})`),
    statusCheck: check('conventions_status_check', sql`${t.status} IN (${inList(CONVENTION_STATUSES)})`),
  }),
);

export type ConventionEvidenceRow = {
  path: string;
  line_start: number;
  line_end: number;
  snippet: string;
};

/** What one scan saw for one identity. Cascades with the scan (retention) and the identity. */
export const conventionObservations = pgTable(
  'convention_observations',
  {
    scanId: uuid('scan_id')
      .notNull()
      .references(() => conventionScans.id, { onDelete: 'cascade' }),
    conventionId: uuid('convention_id')
      .notNull()
      .references(() => conventions.id, { onDelete: 'cascade' }),
    evidence: jsonb('evidence').$type<ConventionEvidenceRow[]>().notNull(),
    supportCount: integer('support_count').notNull().default(0),
    counterCount: integer('counter_count').notNull().default(0),
    reviewHits: integer('review_hits').notNull().default(0),
    llmConfidence: doublePrecision('llm_confidence'),
    confidence: doublePrecision('confidence').notNull(),
    relocated: boolean('relocated').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scanId, t.conventionId] }),
    conventionIdx: index('convention_observations_convention_idx').on(t.conventionId),
    evidenceArrayCheck: check(
      'convention_observations_evidence_array_check',
      sql`jsonb_typeof(${t.evidence}) = 'array'`,
    ),
  }),
);

/** Many-to-many: one convention can feed several skills. */
export const conventionSkills = pgTable(
  'convention_skills',
  {
    conventionId: uuid('convention_id')
      .notNull()
      .references(() => conventions.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conventionId, t.skillId] }),
    skillIdx: index('convention_skills_skill_idx').on(t.skillId),
  }),
);
