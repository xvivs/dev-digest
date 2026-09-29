import { z } from 'zod';
import { FindingCategory, Severity } from './findings.js';
import { CostSource } from './cost.js';
import { EvalCase, ImpactVerdict, Skill, SkillType } from './knowledge.js';

/**
 * Skill impact — Versions, Stats and ablation Evals for a skill.
 * Plan: feat/skill-impact (Phases 1-3). API handshake: specs/03-skill-impact-api.md.
 *
 * `ImpactVerdict` and `SkillLatestVerdict` live in `knowledge.ts` because
 * `SkillListItem` carries them; this file imports from `knowledge.ts`, never
 * the other way round (an import cycle would hit a TDZ at module load).
 *
 * Cost fields follow ADR 0002: `cost_usd` and `cost_source` are null together
 * or set together. The schemas below do not refine that on responses; the
 * server guarantees it.
 */

// ===========================================================================
// Versions (Phase 1)
// ===========================================================================

export const SKILL_CHANGE_NOTE_MAX = 500;

/** Free-text "what changed" note attached to a version. */
export const SkillChangeNote = z.string().trim().max(SKILL_CHANGE_NOTE_MAX);
export type SkillChangeNote = z.infer<typeof SkillChangeNote>;

/**
 * `GET /skills/:id/versions` row: the snapshot without its body.
 *
 * `name`/`description`/`type` are null on snapshots written before the
 * all-field migration (only the body was captured then). A version that has
 * no snapshot row at all is simply absent from the list; the UI renders the
 * gap as "vN body unavailable".
 */
export const SkillVersionSummary = z.object({
  skill_id: z.string(),
  version: z.number().int().positive(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  type: SkillType.nullable(),
  change_note: z.string().nullable(),
  created_at: z.string(),
});
export type SkillVersionSummary = z.infer<typeof SkillVersionSummary>;

/** `GET /skills/:id/versions/:version`: the full snapshot of every versioned field. */
export const SkillVersion = SkillVersionSummary.extend({
  body: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * `POST /skills/:id/versions/:version/restore`. `expected_version` is the
 * skill's CURRENT version as the client last saw it; a mismatch is 409
 * `skill_version_stale`, checked on the no-op path too.
 */
export const RestoreSkillVersionBody = z
  .object({ expected_version: z.number().int().positive() })
  .strict();
export type RestoreSkillVersionBody = z.infer<typeof RestoreSkillVersionBody>;

/** `restored: false` = the target snapshot already equals the current state (no new version). */
export const RestoreSkillVersionResult = z.object({
  skill: Skill,
  restored: z.boolean(),
});
export type RestoreSkillVersionResult = z.infer<typeof RestoreSkillVersionResult>;

/**
 * Wire shape of `PUT /skills/:id` (partial). The server route keeps its own
 * stricter field validation (name slug, body limits, invisible chars) and adds
 * `change_note` from here; this schema is the client-facing type.
 * Any change to name/description/type/body bumps `version`; `enabled` does not.
 */
export const UpdateSkillBody = z
  .object({
    name: z.string(),
    description: z.string(),
    type: SkillType,
    body: z.string(),
    enabled: z.boolean(),
    change_note: SkillChangeNote,
  })
  .partial()
  .strict();
export type UpdateSkillBody = z.infer<typeof UpdateSkillBody>;

// ===========================================================================
// Stats = Usage + Cost (Phase 2)
// ===========================================================================

export const SkillStatsWindow = z.enum(['7d', '30d', '90d']);
export type SkillStatsWindow = z.infer<typeof SkillStatsWindow>;

/** Querystring of `GET /skills/:id/stats`. Anything outside the enum is rejected. */
export const SkillStatsQuery = z.object({
  window: SkillStatsWindow.default('30d'),
});
export type SkillStatsQuery = z.infer<typeof SkillStatsQuery>;

/**
 * Why a linked agent does or does not get this skill in its prompt
 * (`isEffectiveSkill()` in `skills/domain.ts`):
 *  - effective:          link enabled, skill enabled, vetted (or manual)
 *  - link_disabled:      the per-agent link toggle is off
 *  - skill_disabled:     the skill itself is disabled (link is on)
 *  - blocked_by_vetting: needs_vetting, or the vet does not match the current body
 * Precedence when several apply: link_disabled > skill_disabled > blocked_by_vetting.
 */
export const SkillAgentUsageStatus = z.enum([
  'effective',
  'link_disabled',
  'skill_disabled',
  'blocked_by_vetting',
]);
export type SkillAgentUsageStatus = z.infer<typeof SkillAgentUsageStatus>;

export const SkillAgentUsage = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  status: SkillAgentUsageStatus,
  /** Completed runs of this agent inside the window that injected this skill. */
  runs: z.number().int().nonnegative(),
});
export type SkillAgentUsage = z.infer<typeof SkillAgentUsage>;

export const SkillUsageStats = z.object({
  /** Every agent that links the skill, whatever its status. */
  agents: z.array(SkillAgentUsage),
  /** Completed runs inside the window that injected this skill (all agents). */
  runs: z.number().int().nonnegative(),
});
export type SkillUsageStats = z.infer<typeof SkillUsageStats>;

/**
 * Cost footprint = skill tokens × runs. `tokens` is the chars/4 estimate
 * recorded per run (`run_skills.tokens`). `cost_usd` is null together with
 * `cost_source` when no model in the window has a price.
 */
export const SkillCostStats = z.object({
  tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative().nullable(),
  cost_source: CostSource.nullable(),
});
export type SkillCostStats = z.infer<typeof SkillCostStats>;

export const SkillVersionStats = z.object({
  version: z.number().int().positive(),
  runs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative().nullable(),
  cost_source: CostSource.nullable(),
});
export type SkillVersionStats = z.infer<typeof SkillVersionStats>;

// ===========================================================================
// Evals (Phase 3)
// ===========================================================================

// ---- Expectations ----

export const EVAL_EXPECTATION_MAX_ITEMS = 20;
export const EVAL_CONTAINS_MAX = 200;

/** Inclusive 1-based line range in the new file. Matching allows ±3 lines. */
export const EvalLineRange = z
  .object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((r) => r.end >= r.start, { message: 'line_range.end must be >= start', path: ['end'] });
export type EvalLineRange = z.infer<typeof EvalLineRange>;

/**
 * A finding the review MUST produce. Matches when: same `file`, lines within
 * `line_range` ±3 (any line if omitted), severity >= `min_severity`, same
 * `category`, and `contains` (plain case-insensitive substring, never a
 * regex) occurs in the finding title or body.
 */
export const EvalMustFind = z
  .object({
    file: z.string().min(1),
    line_range: EvalLineRange.optional(),
    min_severity: Severity,
    category: FindingCategory,
    contains: z.string().min(1).max(EVAL_CONTAINS_MAX).optional(),
  })
  .strict();
export type EvalMustFind = z.infer<typeof EvalMustFind>;

/**
 * A finding the review must NOT produce (clean cases only). Fields narrow the
 * match; any finding matching every given field fails the case.
 */
export const EvalMustNotFind = z
  .object({
    file: z.string().min(1),
    line_range: EvalLineRange.optional(),
    min_severity: Severity.optional(),
    category: FindingCategory.optional(),
    contains: z.string().min(1).max(EVAL_CONTAINS_MAX).optional(),
  })
  .strict();
export type EvalMustNotFind = z.infer<typeof EvalMustNotFind>;

/**
 * `eval_cases.expected_output` for skill evals. A case is either a defect case
 * (`must_find` non-empty, `must_not_find` empty) or a clean case (`must_find`
 * empty, `must_not_find` non-empty). Legacy rows that do not parse surface as
 * `expectation: null` on `SkillEvalCase` and are skipped by suites.
 */
export const EvalExpectation = z
  .object({
    must_find: z.array(EvalMustFind).max(EVAL_EXPECTATION_MAX_ITEMS).default([]),
    must_not_find: z.array(EvalMustNotFind).max(EVAL_EXPECTATION_MAX_ITEMS).default([]),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.must_find.length === 0 && e.must_not_find.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['must_find'],
        message: 'A case needs at least one must_find or must_not_find entry',
      });
    }
    if (e.must_find.length > 0 && e.must_not_find.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['must_not_find'],
        message: 'must_not_find is only allowed on clean cases (empty must_find)',
      });
    }
  });
export type EvalExpectation = z.infer<typeof EvalExpectation>;
/** Caller-facing input — `.default([])` arrays stay optional. */
export type EvalExpectationInput = z.input<typeof EvalExpectation>;

// ---- Cases ----

export const EVAL_CASE_NAME_MAX = 120;
export const EVAL_CASE_DIFF_MAX = 200_000;
export const EVAL_CASE_PR_FILES_MAX = 50;

/**
 * Where a case's diff comes from. Either way the server snapshots the unified
 * diff into `eval_cases.input_diff`, so a later PR update never changes the case.
 */
export const EvalCaseInputSource = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('paste'),
      diff: z.string().min(1).max(EVAL_CASE_DIFF_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pr'),
      /** `PrMeta.id` of a synced PR in the caller's workspace. */
      pr_id: z.string().uuid(),
      /** Paths from `PrDetail.files[].path`; only these files' patches are kept. */
      files: z.array(z.string().min(1)).min(1).max(EVAL_CASE_PR_FILES_MAX),
    })
    .strict(),
]);
export type EvalCaseInputSource = z.infer<typeof EvalCaseInputSource>;

/** Provenance stored in `input_meta` and echoed on reads (no diff payload). */
export const EvalCaseSourceMeta = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paste') }),
  z.object({
    kind: z.literal('pr'),
    pr_id: z.string(),
    pr_number: z.number().int().nullable(),
    head_sha: z.string().nullable(),
    files: z.array(z.string()),
  }),
]);
export type EvalCaseSourceMeta = z.infer<typeof EvalCaseSourceMeta>;

/** `POST /skills/:id/eval-cases`. Owner is the skill in the path. */
export const CreateEvalCaseBody = z
  .object({
    name: z.string().trim().min(1).max(EVAL_CASE_NAME_MAX),
    source: EvalCaseInputSource,
    expectation: EvalExpectation,
    notes: z.string().max(2000).nullish(),
  })
  .strict();
export type CreateEvalCaseBody = z.infer<typeof CreateEvalCaseBody>;
export type CreateEvalCaseInput = z.input<typeof CreateEvalCaseBody>;

/** `PUT /eval-cases/:id` — partial; a new `source` re-snapshots the diff. */
export const UpdateEvalCaseBody = CreateEvalCaseBody.partial().strict();
export type UpdateEvalCaseBody = z.infer<typeof UpdateEvalCaseBody>;
export type UpdateEvalCaseInput = z.input<typeof UpdateEvalCaseBody>;

/**
 * Skill-owned eval case as returned by the skill eval routes. Extends the
 * legacy `EvalCase` additively: `expected_output` stays the raw column,
 * `expectation` is its parsed form (null when the legacy row does not parse).
 */
export const SkillEvalCase = EvalCase.extend({
  skill_id: z.string().nullable(),
  expectation: EvalExpectation.nullable(),
  input_source: EvalCaseSourceMeta.nullable(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type SkillEvalCase = z.infer<typeof SkillEvalCase>;

// ---- Suites ----

export const EvalSuiteMode = z.enum(['quick', 'full']);
export type EvalSuiteMode = z.infer<typeof EvalSuiteMode>;

/** Repeats per arm. Quick never yields a verdict (always `indicative`). */
export const EVAL_REPEATS: Readonly<Record<EvalSuiteMode, number>> = { quick: 1, full: 3 };

/** Server cap: `cases × 2 arms × repeats` per suite (Full on 25 cases). */
export const EVAL_MAX_JOBS_PER_SUITE = 150;

export const EvalSuiteStatus = z.enum(['estimated', 'running', 'done', 'failed', 'cancelled']);
export type EvalSuiteStatus = z.infer<typeof EvalSuiteStatus>;

/** Statuses after which the suite never changes again (client stops polling). */
export const EVAL_SUITE_TERMINAL_STATUSES: readonly EvalSuiteStatus[] = ['done', 'failed', 'cancelled'];

/** `with` = carrier skills + target@version; `without` = same minus target. */
export const EvalArm = z.enum(['with', 'without']);
export type EvalArm = z.infer<typeof EvalArm>;

/**
 * Suite aggregate (ADR 0017). Computed per case, then summed:
 *  - passing:  settled cases whose `with` arm passed in every repeat
 *  - total:    settled cases (errored and pending cases excluded, see `errored`)
 *  - caught:   non-flaky cases that pass only with the skill
 *  - regressed: non-flaky cases that pass only without the skill
 *  - flaky:    cases whose repeats disagree within one arm (excluded from caught/regressed)
 *  - errored:  cases with a failed run; never counted as failing
 *  - delta_unexpected: mean unexpected findings per case, with minus without
 */
export const EvalSuiteResults = z.object({
  passing: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  caught: z.number().int().nonnegative(),
  regressed: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  /**
   * Cases where at least one run failed (timeout, provider error, cancel). They
   * are excluded from every other figure: `passing`/`total` count settled cases
   * only. Absent on suites closed before this field existed → 0.
   */
  errored: z.number().int().nonnegative().default(0),
  delta_unexpected: z.number(),
  verdict: ImpactVerdict,
});
export type EvalSuiteResults = z.infer<typeof EvalSuiteResults>;

export const EvalSuite = z.object({
  id: z.string(),
  skill_id: z.string(),
  /** Skill version under test, and `sha256(name + body)` of that version — the stale key. */
  skill_version: z.number().int().positive(),
  prompt_sha256: z.string(),
  carrier_agent_id: z.string(),
  carrier_agent_version: z.number().int().positive(),
  /** Carrier's current name at read time; null if the agent was deleted. */
  carrier_name: z.string().nullable(),
  /** Always the carrier's model. */
  model: z.string(),
  mode: EvalSuiteMode,
  repeats: z.number().int().positive(),
  status: EvalSuiteStatus,
  total_jobs: z.number().int().nonnegative(),
  done_jobs: z.number().int().nonnegative(),
  /** Pre-run estimate; always a local estimate (ADR 0002 `estimated`). */
  estimate_usd: z.number().nonnegative(),
  cost_usd: z.number().nonnegative().nullable(),
  cost_source: CostSource.nullable(),
  /** True when the skill's current prompt_sha256 or the carrier's version moved since. */
  stale: z.boolean(),
  results: EvalSuiteResults.nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type EvalSuite = z.infer<typeof EvalSuite>;

/**
 * `GET /skills/:id/eval-carriers` — agents that can carry an eval of this skill:
 * those linking it with the link ENABLED (`agent_skills.enabled`). Most completed
 * runs with the skill first, ties by name; exactly the first is `is_default`.
 * Empty when no agent qualifies (the client shows "link the skill to an agent").
 */
export const EvalCarrier = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** Completed runs of this agent that injected the skill. */
  runs: z.number().int().nonnegative(),
  is_default: z.boolean(),
});
export type EvalCarrier = z.infer<typeof EvalCarrier>;

/** `POST /skills/:id/eval-suites`. Creates a suite in `estimated`; nothing runs yet. */
export const CreateEvalSuiteBody = z
  .object({
    /** Must link the skill with an enabled link, else 422 `eval_carrier_not_linked`. */
    carrier_agent_id: z.string().uuid(),
    mode: EvalSuiteMode,
  })
  .strict();
export type CreateEvalSuiteBody = z.infer<typeof CreateEvalSuiteBody>;

// ---- Runs (one job = one case × arm × repeat) ----

export const EvalRunStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/**
 * One ablation job. Named `EvalSuiteRun` because the legacy metrics shape
 * already owns `EvalRun` (knowledge.ts); both map onto `eval_runs` rows.
 */
export const EvalSuiteRun = z.object({
  id: z.string(),
  suite_id: z.string(),
  case_id: z.string(),
  arm: EvalArm,
  repeat_idx: z.number().int().nonnegative(),
  status: EvalRunStatus,
  /** null until done; also null on failed. */
  pass: z.boolean().nullable(),
  /** must_find entries matched / total (0/0 on clean cases). */
  matched: z.number().int().nonnegative().nullable(),
  expected: z.number().int().nonnegative().nullable(),
  /** Findings that matched no must_find entry. */
  unexpected: z.number().int().nonnegative().nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  cost_source: CostSource.nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  ran_at: z.string().nullable(),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

/** Per-case row of the suite table: both arms as passes/repeats + a badge. */
export const EvalCaseOutcome = z.enum([
  'caught', // passes only with the skill
  'regressed', // passes only without the skill
  'pass_both',
  'fail_both',
  'flaky',
  'pending', // not all repeats finished
  'error', // at least one job failed
]);
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

export const EvalArmTally = z.object({
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type EvalArmTally = z.infer<typeof EvalArmTally>;

export const EvalSuiteCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  with: EvalArmTally,
  without: EvalArmTally,
  outcome: EvalCaseOutcome,
});
export type EvalSuiteCaseResult = z.infer<typeof EvalSuiteCaseResult>;

/** `GET /eval-suites/:id` — the polling target. */
export const EvalSuiteDetail = EvalSuite.extend({
  cases: z.array(EvalSuiteCaseResult),
  runs: z.array(EvalSuiteRun),
});
export type EvalSuiteDetail = z.infer<typeof EvalSuiteDetail>;

// ===========================================================================
// Stats response (needs EvalSuite, hence defined last)
// ===========================================================================

/**
 * Impact block of the Stats tab: the latest suite's verdict for this skill.
 * Null on the whole block until any suite exists (Phase 2 always sends null).
 */
export const SkillImpact = z.object({
  verdict: ImpactVerdict,
  stale: z.boolean(),
  /** Latest Full suite if one is done, else the latest suite of any mode. */
  suite: EvalSuite,
});
export type SkillImpact = z.infer<typeof SkillImpact>;

/** `GET /skills/:id/stats?window=` */
export const SkillStats = z.object({
  skill_id: z.string(),
  window: SkillStatsWindow,
  usage: SkillUsageStats,
  cost: SkillCostStats,
  by_version: z.array(SkillVersionStats),
  impact: SkillImpact.nullable(),
});
export type SkillStats = z.infer<typeof SkillStats>;
