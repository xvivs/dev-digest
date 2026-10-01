import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/** Confidence in a derived intent; capped deterministically in code. */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const IntentSourceKind = z.enum([
  'title',
  'description',
  'issue',
  'spec',
  'branch',
  'commits',
  'paths',
  'diffstat',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/** One input that fed the intent derivation (`ref` is a path/issue ref, never PR text). */
export const IntentSource = z.object({
  kind: IntentSourceKind,
  ref: z.string().nullable(),
  chars: z.number().int(),
});
export type IntentSource = z.infer<typeof IntentSource>;

export const UnresolvedLinkReason = z.enum([
  'external_host',
  'other_repo',
  'not_a_doc',
  'not_found',
  'not_available',
  'too_large',
  'unsafe_path',
  'limit_reached',
  'fetch_failed',
]);
export type UnresolvedLinkReason = z.infer<typeof UnresolvedLinkReason>;

/** A link found in the PR that was recorded but never fetched/read. */
export const UnresolvedLink = z.object({
  url: z.string(),
  reason: UnresolvedLinkReason,
});
export type UnresolvedLink = z.infer<typeof UnresolvedLink>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

export const BlastStatus = z.enum(['ok', 'degraded', 'unavailable']);
export type BlastStatus = z.infer<typeof BlastStatus>;

export const BlastReason = z.enum(['index_partial', 'no_index', 'flag_off', 'no_changed_files']);
export type BlastReason = z.infer<typeof BlastReason>;

/** Response of `GET /pulls/:id/blast`. */
export const PrBlastResponse = z.object({
  status: BlastStatus,
  reason: BlastReason.nullable(),
  blast: BlastRadius.nullable(),
  head_sha: z.string(),
  source_sha: z.string().nullable(),
  index_status: z.string(),
  cached: z.boolean(),
  truncated: z.boolean(),
  computed_at: z.string().nullable(),
});
export type PrBlastResponse = z.infer<typeof PrBlastResponse>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const RiskKind = z.enum(['security', 'db_migration', 'breaking_api', 'perf', 'deps']);
export type RiskKind = z.infer<typeof RiskKind>;

export const Risk = z.object({
  kind: RiskKind,
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
  /** `rule` = deterministic pre-pass; `model` = LLM-derived. */
  origin: z.enum(['rule', 'model']),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

export const HistoryStatus = z.enum(['ok', 'unavailable']);
export type HistoryStatus = z.infer<typeof HistoryStatus>;

export const HistoryReason = z.enum(['no_github', 'fetch_failed', 'no_changed_files']);
export type HistoryReason = z.infer<typeof HistoryReason>;

/** Response of `GET /pulls/:id/history`. */
export const PrHistoryResponse = z.object({
  status: HistoryStatus,
  reason: HistoryReason.nullable(),
  history: z.array(PrHistoryItem),
  queried_paths: z.array(z.string()),
  cached: z.boolean(),
  computed_at: z.string().nullable(),
});
export type PrHistoryResponse = z.infer<typeof PrHistoryResponse>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
