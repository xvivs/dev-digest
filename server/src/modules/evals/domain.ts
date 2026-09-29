/**
 * DOMAIN — the core ring of the `evals` module (plan Phase 3, ADR 0017/0018).
 * Pure: no I/O, no container, no Drizzle, no Fastify, no runtime zod. Only
 * `import type` from `@devdigest/shared`, `_shared/eval-suite.ts` (types) and
 * the error taxonomy in `platform/errors.ts`.
 *
 * Holds the whole measurement model: finding ↔ expectation matching, the
 * per-run pass rule, per-case classification (flaky / caught / regressed),
 * the suite verdict and its thresholds, the pre-run estimate, the budget and
 * trust guards, and the staleness key.
 */
import type {
  CostSource,
  EvalArm,
  EvalArmTally,
  EvalCaseOutcome,
  EvalCaseSourceMeta,
  EvalExpectation,
  EvalMustFind,
  EvalMustNotFind,
  EvalRunStatus,
  EvalSuiteCaseResult,
  EvalSuiteMode,
  EvalSuiteResults,
  EvalSuiteStatus,
  Finding,
  ImpactVerdict,
  Severity,
  SkillSource,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { LLM_CALL_TIMEOUT_MS, LLM_STRUCTURED_MAX_RETRIES } from '../../platform/llm-limits.js';
import { DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS, DEFAULT_RETRIES } from '../../platform/resilience.js';
import type { EvalSuiteView } from '../_shared/eval-suite.js';

export type { EvalSuiteView };

// ---------------------------------------------------------------------------
// Named constants (ADR 0017 thresholds, ADR 0018 limits)
// ---------------------------------------------------------------------------

/** A finding matches an expected line range within ±3 lines. */
export const LINE_TOLERANCE = 3;
/** Fewer non-flaky cases than this → `indicative`, whatever the counts say. */
export const MIN_NON_FLAKY_CASES = 5;
/** Hurts when the skill adds more than this many unexpected findings per case. */
export const HURTS_DELTA_UNEXPECTED = 2;
/** Helps only while the skill adds at most this many unexpected findings per case. */
export const HELPS_MAX_DELTA_UNEXPECTED = 1;
/** Repeats per arm (mirrors the contract's `EVAL_REPEATS`). */
export const EVAL_REPEATS: Readonly<Record<EvalSuiteMode, number>> = { quick: 1, full: 3 };
/** Server cap on `cases × 2 arms × repeats` (mirrors `EVAL_MAX_JOBS_PER_SUITE`). */
export const EVAL_MAX_JOBS_PER_SUITE = 150;
export const EVAL_ARMS: readonly EvalArm[] = ['with', 'without'];

/** Mirrors reviewer-core `DEFAULT_MAP_THRESHOLD_LINES` (auto strategy). */
export const MAP_THRESHOLD_LINES = 400;
/** Fixed prompt scaffolding per chunk (headings, delimiters, schema hint), tokens. */
export const PROMPT_OVERHEAD_TOKENS = 600;
/** Assumed structured-output size per chunk, tokens. */
export const EST_OUTPUT_TOKENS_PER_CHUNK = 800;

/** What one adapter call can burn, wall-clock (numbers owned by `platform/`). */
export interface LlmLimits {
  /** Per-attempt timeout. */
  callTimeoutMs: number;
  /** `withRetry` retries on 429/5xx (attempts = retries + 1). */
  transientRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Structured-output reprompts (attempts = retries + 1). */
  structuredRetries: number;
}

export const LLM_LIMITS: LlmLimits = {
  callTimeoutMs: LLM_CALL_TIMEOUT_MS,
  transientRetries: DEFAULT_RETRIES,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  structuredRetries: LLM_STRUCTURED_MAX_RETRIES,
};

/**
 * Worst case of ONE `completeStructured` call: every structured attempt
 * (`structuredRetries + 1`) runs the full `withRetry` ladder, each attempt
 * hitting its timeout, plus the backoff sleeps (with up to one `baseDelayMs`
 * of jitter each). Adapters: `adapters/llm/{openai,anthropic}.ts`.
 */
export function worstCaseCallMs(l: LlmLimits): number {
  let backoff = 0;
  for (let k = 0; k < l.transientRetries; k++) backoff += Math.min(l.maxDelayMs, l.baseDelayMs * 2 ** k) + l.baseDelayMs;
  const perStructuredAttempt = (l.transientRetries + 1) * l.callTimeoutMs + backoff;
  return (l.structuredRetries + 1) * perStructuredAttempt;
}

/**
 * Wall-clock budget per chunk = the worst case of its one adapter call. The
 * job timeout only frees the queue slot and marks the `jobs` mirror; it never
 * stops a call in flight (ADR 0018).
 */
export const EVAL_CHUNK_TIMEOUT_MS = worstCaseCallMs(LLM_LIMITS);
export const EVAL_JOB_TIMEOUT_HEADROOM_MS = 60_000;

const SEVERITY_RANK: Record<Severity, number> = { SUGGESTION: 0, WARNING: 1, CRITICAL: 2 };

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface EvalCase {
  id: string;
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  skillId: string | null;
  name: string;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  /** Raw column, whatever a legacy row holds. */
  expectedOutput: unknown;
  /** Parsed `expectedOutput`; null when a legacy row does not parse. */
  expectation: EvalExpectation | null;
  /** Parsed `inputMeta`; null when it does not parse. */
  inputSource: EvalCaseSourceMeta | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewEvalCase {
  workspaceId: string;
  skillId: string;
  name: string;
  inputDiff: string;
  inputFiles: string[];
  inputSource: EvalCaseSourceMeta;
  expectation: EvalExpectation;
  notes: string | null;
}

export type EvalCasePatch = Partial<
  Pick<NewEvalCase, 'name' | 'inputDiff' | 'inputFiles' | 'inputSource' | 'expectation' | 'notes'>
>;

/** A skill as the eval module needs it: trust state + both hashes of its current body. */
export interface EvalTargetSkill {
  id: string;
  workspaceId: string;
  name: string;
  body: string;
  version: number;
  source: SkillSource;
  vettedBodyHash: string | null;
  /** sha256(body) — what `vetted_body_hash` holds. */
  bodySha256: string;
  /** ADR 0017 sha256(name + "\n" + body). */
  promptSha256: string;
}

export interface EvalCarrier {
  id: string;
  name: string;
  version: number;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto';
}

export interface EvalSkillText {
  id: string;
  name: string;
  body: string;
}

/**
 * Frozen at suite creation (`eval_suites.run_config`) so every job of the
 * suite sends the same prompt, even if the agent or its links change mid-run.
 */
export interface EvalRunConfig {
  provider: EvalCarrier['provider'];
  systemPrompt: string;
  strategy: EvalCarrier['strategy'];
  /** Ordered `with` arm, target at the pinned version included. */
  withSkills: EvalSkillText[];
}

/** A persisted suite (no derived fields). */
export interface EvalSuiteRecord {
  id: string;
  workspaceId: string;
  skillId: string;
  skillVersion: number;
  promptSha256: string;
  carrierAgentId: string;
  carrierAgentVersion: number;
  carrierAgentName: string;
  model: string;
  runConfig: EvalRunConfig;
  mode: EvalSuiteMode;
  repeats: number;
  status: EvalSuiteStatus;
  totalJobs: number;
  doneJobs: number;
  estimateUsd: number;
  costUsd: number | null;
  costSource: CostSource | null;
  results: EvalSuiteResults | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export type NewEvalSuite = Omit<
  EvalSuiteRecord,
  'id' | 'status' | 'doneJobs' | 'costUsd' | 'costSource' | 'results' | 'error' | 'createdAt' | 'startedAt' | 'finishedAt'
>;

/** One job = one case × arm × repeat (`eval_runs` row). */
export interface EvalRunRecord {
  id: string;
  suiteId: string;
  caseId: string;
  arm: EvalArm;
  repeatIdx: number;
  status: EvalRunStatus;
  pass: boolean | null;
  matched: number | null;
  expected: number | null;
  unexpected: number | null;
  citationAccuracy: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  costSource: CostSource | null;
  durationMs: number | null;
  error: string | null;
  ranAt: Date | null;
}

/** What a finished job writes. */
export type EvalRunResult =
  | {
      status: 'done';
      pass: boolean;
      matched: number;
      expected: number;
      unexpected: number;
      citationAccuracy: number | null;
      tokensIn: number;
      tokensOut: number;
      costUsd: number | null;
      costSource: CostSource | null;
      durationMs: number;
      actualOutput: unknown;
    }
  | { status: 'failed'; error: string; durationMs: number };

// ---------------------------------------------------------------------------
// Errors (the codes are the API contract, specs/03-skill-impact-api.md)
// ---------------------------------------------------------------------------

export class EvalSkillNotVettedError extends AppError {
  constructor() {
    super(
      'eval_skill_not_vetted',
      'Vet the skill first: an unvetted imported skill is never sent to a model (ADR 0012).',
      409,
    );
  }
}

export class EvalNoCasesError extends AppError {
  constructor() {
    super('eval_no_cases', 'The skill has no runnable eval cases', 422);
  }
}

export class EvalPriceUnknownError extends AppError {
  constructor(model: string) {
    super('eval_price_unknown', `No price is known for model "${model}", so no estimate can be made`, 422, {
      model,
    });
  }
}

export class EvalTooManyJobsError extends AppError {
  constructor(jobs: number) {
    super('eval_too_many_jobs', `A suite may run at most ${EVAL_MAX_JOBS_PER_SUITE} jobs (this one needs ${jobs})`, 422, {
      jobs,
      max: EVAL_MAX_JOBS_PER_SUITE,
    });
  }
}

export class EvalBudgetExceededError extends AppError {
  constructor(estimateUsd: number, maxUsd: number) {
    super('eval_budget_exceeded', `Estimated $${estimateUsd.toFixed(4)} exceeds the $${maxUsd} suite budget`, 422, {
      estimate_usd: estimateUsd,
      max_usd: maxUsd,
    });
  }
}

export class EvalSuiteBusyError extends AppError {
  constructor() {
    super('eval_suite_busy', 'Another eval suite is already running in this workspace', 409);
  }
}

export class EvalSuiteStaleError extends AppError {
  constructor() {
    super(
      'eval_suite_stale',
      'The skill prompt or the carrier agent changed since this estimate. Create a new suite.',
      409,
    );
  }
}

export class EvalCaseFileNotInPrError extends AppError {
  constructor(files: string[], reason: 'not_in_pr' | 'no_patch') {
    super(
      'eval_case_file_not_in_pr',
      reason === 'not_in_pr'
        ? `Not a file of this PR: ${files.join(', ')}`
        : `No patch stored for: ${files.join(', ')} (binary or too large)`,
      422,
      { files, reason },
    );
  }
}

export class EvalNoCarrierError extends AppError {
  constructor() {
    super('eval_no_carrier', 'No carrier agent given and no agent links this skill', 422);
  }
}

/** Thrown between chunks when the suite was cancelled (ADR 0018 §7). */
export class EvalCancelledError extends Error {
  constructor() {
    super('Suite cancelled');
    this.name = 'EvalCancelledError';
  }
}

// ---------------------------------------------------------------------------
// Matching + scoring (ADR 0017 §8)
// ---------------------------------------------------------------------------

/** Diff-style prefixes (`a/`, `b/`, `./`, `/`) never make two paths differ. */
export function normalizePath(path: string): string {
  return path.trim().replace(/^(?:[ab]\/|\.\/|\/)+/, '');
}

function linesMatch(f: Pick<Finding, 'start_line' | 'end_line'>, range: EvalMustFind['line_range']): boolean {
  if (!range) return true;
  const lo = Math.min(f.start_line, f.end_line);
  const hi = Math.max(f.start_line, f.end_line);
  return hi >= range.start - LINE_TOLERANCE && lo <= range.end + LINE_TOLERANCE;
}

/** Plain case-insensitive substring over title + rationale + suggestion. Never a regex. */
function containsText(f: Finding, needle: string | undefined): boolean {
  if (needle === undefined) return true;
  const hay = `${f.title}\n${f.rationale}\n${f.suggestion ?? ''}`.toLowerCase();
  return hay.includes(needle.toLowerCase());
}

function severityAtLeast(actual: Severity, min: Severity | undefined): boolean {
  return min === undefined || SEVERITY_RANK[actual] >= SEVERITY_RANK[min];
}

export function matchesMustFind(f: Finding, e: EvalMustFind): boolean {
  return (
    normalizePath(f.file) === normalizePath(e.file) &&
    linesMatch(f, e.line_range) &&
    severityAtLeast(f.severity, e.min_severity) &&
    f.category === e.category &&
    containsText(f, e.contains)
  );
}

/** Every GIVEN field must match; omitted fields match anything. */
export function matchesMustNotFind(f: Finding, e: EvalMustNotFind): boolean {
  return (
    normalizePath(f.file) === normalizePath(e.file) &&
    linesMatch(f, e.line_range) &&
    severityAtLeast(f.severity, e.min_severity) &&
    (e.category === undefined || f.category === e.category) &&
    containsText(f, e.contains)
  );
}

export interface RunScore {
  pass: boolean;
  /** must_find entries matched by at least one finding. */
  matched: number;
  expected: number;
  /** Findings that matched no must_find entry. */
  unexpected: number;
}

/** Pass = every must_find matched and no finding hits a must_not_find. */
export function scoreRun(findings: Finding[], expectation: EvalExpectation): RunScore {
  const matchedEntries = expectation.must_find.filter((e) => findings.some((f) => matchesMustFind(f, e)));
  const unexpected = findings.filter((f) => !expectation.must_find.some((e) => matchesMustFind(f, e))).length;
  const forbidden = findings.some((f) => expectation.must_not_find.some((e) => matchesMustNotFind(f, e)));
  return {
    pass: matchedEntries.length === expectation.must_find.length && !forbidden,
    matched: matchedEntries.length,
    expected: expectation.must_find.length,
    unexpected,
  };
}

/** Citation accuracy from reviewer-core's `"kept/total passed"`; 0/0 → null. */
export function citationAccuracyOf(grounding: string): number | null {
  const m = /^(\d+)\/(\d+)/.exec(grounding);
  if (!m) return null;
  const kept = Number(m[1]);
  const total = Number(m[2]);
  return total === 0 ? null : kept / total;
}

// ---------------------------------------------------------------------------
// Per-case classification + suite verdict (ADR 0017 §5-6)
// ---------------------------------------------------------------------------

export type ClassifiableRun = Pick<EvalRunRecord, 'arm' | 'status' | 'pass' | 'unexpected'>;

export interface CaseClassification {
  with: EvalArmTally;
  without: EvalArmTally;
  outcome: EvalCaseOutcome;
}

function tally(runs: ClassifiableRun[], arm: EvalArm, repeats: number): EvalArmTally {
  return {
    passed: runs.filter((r) => r.arm === arm && r.status === 'done' && r.pass === true).length,
    total: repeats,
  };
}

export function classifyCase(runs: ClassifiableRun[], repeats: number): CaseClassification {
  const w = tally(runs, 'with', repeats);
  const wo = tally(runs, 'without', repeats);
  const doneIn = (arm: EvalArm) => runs.filter((r) => r.arm === arm && r.status === 'done').length;

  let outcome: EvalCaseOutcome;
  if (runs.some((r) => r.status === 'failed')) outcome = 'error';
  else if (doneIn('with') < repeats || doneIn('without') < repeats) outcome = 'pending';
  else if (repeats > 1 && ((w.passed > 0 && w.passed < repeats) || (wo.passed > 0 && wo.passed < repeats))) {
    outcome = 'flaky';
  } else {
    const withPass = w.passed === repeats;
    const withoutPass = wo.passed === repeats;
    outcome = withPass
      ? withoutPass
        ? 'pass_both'
        : 'caught'
      : withoutPass
        ? 'regressed'
        : 'fail_both';
  }
  return { with: w, without: wo, outcome };
}

const NON_FLAKY: ReadonlySet<EvalCaseOutcome> = new Set(['caught', 'regressed', 'pass_both', 'fail_both']);

export function verdictFor(input: {
  mode: EvalSuiteMode;
  nonFlaky: number;
  caught: number;
  regressed: number;
  deltaUnexpected: number;
}): ImpactVerdict {
  // Quick has 1 repeat: no flaky detection, so no verdict (plan decision #6).
  if (input.mode !== 'full') return 'indicative';
  if (input.nonFlaky < MIN_NON_FLAKY_CASES) return 'indicative';
  if (input.regressed > input.caught || input.deltaUnexpected > HURTS_DELTA_UNEXPECTED) return 'hurts';
  if (input.caught >= 1 && input.regressed === 0 && input.deltaUnexpected <= HELPS_MAX_DELTA_UNEXPECTED) {
    return 'helps';
  }
  return 'neutral';
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Per case first, then summed (ADR 0017). `delta_unexpected` averages, over
 * cases whose jobs all finished (flaky included: the unexpected count is a
 * separate signal from pass/fail), the per-case mean unexpected findings
 * with the skill minus without. Error/pending cases are excluded from
 * every figure; `errored` reports how many failed so the UI can say so.
 * `passing / total` are over settled (non-error, non-pending) cases.
 */
export function summarizeSuite(input: {
  mode: EvalSuiteMode;
  repeats: number;
  cases: { id: string; name: string }[];
  runs: (ClassifiableRun & { caseId: string })[];
}): { results: EvalSuiteResults; cases: EvalSuiteCaseResult[] } {
  const rows: EvalSuiteCaseResult[] = [];
  const deltas: number[] = [];
  for (const c of input.cases) {
    const runs = input.runs.filter((r) => r.caseId === c.id);
    const cls = classifyCase(runs, input.repeats);
    rows.push({ case_id: c.id, case_name: c.name, with: cls.with, without: cls.without, outcome: cls.outcome });
    if (cls.outcome !== 'error' && cls.outcome !== 'pending') {
      const unexpectedIn = (arm: EvalArm) =>
        mean(runs.filter((r) => r.arm === arm && r.status === 'done').map((r) => r.unexpected ?? 0));
      deltas.push(unexpectedIn('with') - unexpectedIn('without'));
    }
  }
  const count = (o: EvalCaseOutcome) => rows.filter((r) => r.outcome === o).length;
  const caught = count('caught');
  const regressed = count('regressed');
  const deltaUnexpected = Math.round(mean(deltas) * 1000) / 1000;
  // `passing / total` are over settled cases only: an errored case says nothing
  // about the skill, so it can neither lower `passing` nor inflate `total`.
  const settled = rows.filter((r) => r.outcome !== 'error' && r.outcome !== 'pending');
  const nonFlaky = rows.filter((r) => NON_FLAKY.has(r.outcome)).length;
  return {
    cases: rows,
    results: {
      passing: settled.filter((r) => r.with.total > 0 && r.with.passed === r.with.total).length,
      total: settled.length,
      errored: count('error'),
      caught,
      regressed,
      flaky: count('flaky'),
      delta_unexpected: deltaUnexpected,
      verdict: verdictFor({ mode: input.mode, nonFlaky, caught, regressed, deltaUnexpected }),
    },
  };
}

/**
 * Suite cost = the sum over DONE runs (ADR 0002 pair). "Weakest claim wins":
 * any `estimated` makes the sum `estimated`; a done run with no cost makes
 * the whole sum unknown. Failed runs carry no cost at all (what they spent
 * is unknown), so they are left out rather than nulling every suite that had
 * one failure.
 */
export function suiteCost(
  runs: Pick<EvalRunRecord, 'status' | 'costUsd' | 'costSource'>[],
): { costUsd: number | null; costSource: CostSource | null } {
  const done = runs.filter((r) => r.status === 'done');
  if (done.length === 0) return { costUsd: null, costSource: null };
  let sum = 0;
  let source: CostSource = 'provider';
  for (const r of done) {
    if (r.costUsd === null || r.costSource === null) return { costUsd: null, costSource: null };
    sum += r.costUsd;
    if (r.costSource === 'estimated') source = 'estimated';
  }
  return { costUsd: sum, costSource: source };
}

/** Terminal status of a suite whose every job has finished. */
export function closingStatus(runs: Pick<EvalRunRecord, 'status' | 'error'>[]): {
  status: 'done' | 'failed';
  error: string | null;
} {
  if (runs.length > 0 && runs.every((r) => r.status === 'failed')) {
    const first = runs.find((r) => r.error)?.error ?? 'unknown error';
    return { status: 'failed', error: `All ${runs.length} eval runs failed; first error: ${first}` };
  }
  if (runs.length === 0) return { status: 'failed', error: 'The suite has no runs (its cases were deleted)' };
  return { status: 'done', error: null };
}

// ---------------------------------------------------------------------------
// Guards (ADR 0012 trust gate, ADR 0018 budget)
// ---------------------------------------------------------------------------

/** ADR 0012: a non-manual skill is evaluated only on the exact body a person vetted. */
export function assertEvalTrusted(
  skill: Pick<EvalTargetSkill, 'source' | 'vettedBodyHash'>,
  targetBodySha256: string,
): void {
  if (skill.source !== 'manual' && skill.vettedBodyHash !== targetBodySha256) {
    throw new EvalSkillNotVettedError();
  }
}

export function totalJobsFor(cases: number, repeats: number): number {
  return cases * EVAL_ARMS.length * repeats;
}

export function assertJobLimit(cases: number, repeats: number): void {
  const jobs = totalJobsFor(cases, repeats);
  if (jobs > EVAL_MAX_JOBS_PER_SUITE) throw new EvalTooManyJobsError(jobs);
}

export function assertWithinBudget(estimateUsd: number, maxUsd: number): void {
  if (estimateUsd > maxUsd) throw new EvalBudgetExceededError(estimateUsd, maxUsd);
}

// ---------------------------------------------------------------------------
// Staleness (ADR 0017 §7)
// ---------------------------------------------------------------------------

export function isSuiteStale(
  suite: Pick<EvalSuiteRecord, 'promptSha256' | 'carrierAgentVersion'>,
  current: { promptSha256: string | null; carrierVersion: number | null },
): boolean {
  return suite.promptSha256 !== current.promptSha256 || suite.carrierAgentVersion !== current.carrierVersion;
}

// ---------------------------------------------------------------------------
// Carrier + arms (ADR 0018 §9)
// ---------------------------------------------------------------------------

export interface CarrierCandidate {
  agentId: string;
  agentName: string;
  /** Completed runs of this agent that injected the skill. */
  runs: number;
}

/** Plan decision #5: the agent with the most runs with the skill; ties by name. */
export function pickDefaultCarrier(candidates: CarrierCandidate[]): string | null {
  const sorted = [...candidates].sort((a, b) => b.runs - a.runs || a.agentName.localeCompare(b.agentName));
  return sorted[0]?.agentId ?? null;
}

/**
 * `with` = the carrier's effective skills with the target pinned at the
 * suite's version, in the target's link position (appended when the carrier
 * does not link it). `without` = the same list minus the target.
 */
export function armSkills(carrierSkills: EvalSkillText[], target: EvalSkillText, arm: EvalArm): EvalSkillText[] {
  if (arm === 'without') return carrierSkills.filter((s) => s.id !== target.id);
  const linked = carrierSkills.some((s) => s.id === target.id);
  return linked ? carrierSkills.map((s) => (s.id === target.id ? target : s)) : [...carrierSkills, target];
}

// ---------------------------------------------------------------------------
// Estimate (ADR 0018 §5)
// ---------------------------------------------------------------------------

/** ceil(chars / 4), the same estimate reviewer-core's `estimateTokens` uses. */
const tokensOf = (chars: number) => Math.ceil(chars / 4);

export interface DiffFileStat {
  path: string;
  additions: number;
  deletions: number;
}

/** How many LLM calls one review of this diff makes (mirrors reviewer-core `selectMode`). */
export function chunkCount(strategy: EvalCarrier['strategy'], files: DiffFileStat[]): number {
  if (files.length <= 1 || strategy === 'single-pass') return 1;
  if (strategy === 'map-reduce') return files.length;
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  return lines > MAP_THRESHOLD_LINES ? files.length : 1;
}

/**
 * Tokens of one job. Every chunk repeats the system prompt, the skills block
 * and the scaffolding; the diff is split across chunks. Structured-output
 * reprompts and adapter retries are NOT included, so actual spend can exceed
 * the estimate (ADR 0018 "What this costs").
 */
export function estimateJob(input: {
  systemPrompt: string;
  skillsChars: number;
  diffChars: number;
  files: DiffFileStat[];
  strategy: EvalCarrier['strategy'];
}): { chunks: number; tokensIn: number; tokensOut: number } {
  const chunks = chunkCount(input.strategy, input.files);
  const perChunk = tokensOf(input.systemPrompt.length) + tokensOf(input.skillsChars) + PROMPT_OVERHEAD_TOKENS;
  return {
    chunks,
    tokensIn: chunks * perChunk + tokensOf(input.diffChars),
    tokensOut: chunks * EST_OUTPUT_TOKENS_PER_CHUNK,
  };
}

/** Rendered size of a skills block (`### name\nbody` per skill). */
export function skillsChars(skills: EvalSkillText[]): number {
  return skills.reduce((n, s) => n + s.name.length + s.body.length + 6, 0);
}

export function jobTimeoutMs(chunks: number, limits: LlmLimits = LLM_LIMITS): number {
  return Math.max(1, chunks) * worstCaseCallMs(limits) + EVAL_JOB_TIMEOUT_HEADROOM_MS;
}

// ---------------------------------------------------------------------------
// Case input
// ---------------------------------------------------------------------------

/** Same synthetic unified diff the review diff-loader builds from `pr_files`. */
export function unifiedDiffFromPatches(files: { path: string; patch: string }[]): string {
  return files
    .map((f) => [`diff --git a/${f.path} b/${f.path}`, `--- a/${f.path}`, `+++ b/${f.path}`, f.patch].join('\n'))
    .join('\n');
}

/** Expectation entries naming a file that is not in the case diff can never match. */
export function expectationFilesOutsideDiff(expectation: EvalExpectation, diffFiles: string[]): string[] {
  const inDiff = new Set(diffFiles.map(normalizePath));
  const named = [...expectation.must_find, ...expectation.must_not_find].map((e) => e.file);
  return [...new Set(named.filter((f) => !inDiff.has(normalizePath(f))))];
}
