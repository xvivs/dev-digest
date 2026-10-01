/**
 * Pure projections from API shapes to tool outputs: selection, sorting,
 * filtering, truncation, counts and the null rules. No I/O. Each projection's
 * return type is the tool's `z.infer<typeof XOutput>`, so tsc checks it against
 * the output schema (excess-property checks only apply to fresh literals).
 */
import type { AgentLite, ConventionsLite, FindingLite, ReviewLite, RunLite } from './api/schemas.js';
import { runPhase } from './run-status.js';
import type { GetBlastRadiusOutput } from './tools/get-blast-radius.js';
import type { GetConventionsOutput } from './tools/get-conventions.js';
import type { GetFindingsOutput } from './tools/get-findings.js';
import type { ListAgentsOutput } from './tools/list-agents.js';
import type { RunAgentOnPrOutput } from './tools/run-agent-on-pr.js';

export type SeverityName = 'CRITICAL' | 'WARNING' | 'SUGGESTION';
export type SeverityCounts = Record<SeverityName, number>;

export const FINDINGS_LIMIT_DEFAULT = 20;
export const FINDINGS_LIMIT_MAX = 50;
export const RATIONALE_MAX = 600;
export const SUGGESTION_MAX = 300;
export const TITLE_MAX = 200;
export const SUMMARY_MAX = 1500;
export const CONVENTIONS_MAX = 50;
export const RULE_MAX = 400;
export const EVIDENCE_MAX = 2;

const SEVERITY_RANK: Record<SeverityName, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Cut to at most `max` chars; a cut string ends in `…`. */
export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---- list_agents -----------------------------------------------------------

export function projectAgents(agents: readonly AgentLite[]): ListAgentsOutput {
  return {
    agents: [...agents]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, name: a.name, description: a.description, model: a.model, enabled: a.enabled })),
  };
}

// ---- findings --------------------------------------------------------------

export function severityCounts(findings: readonly Pick<FindingLite, 'severity'>[]): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

export function findingState(f: Pick<FindingLite, 'accepted_at' | 'dismissed_at'>): 'open' | 'accepted' | 'dismissed' {
  if (f.accepted_at) return 'accepted';
  if (f.dismissed_at) return 'dismissed';
  return 'open';
}

type FindingOut = GetFindingsOutput['findings'][number];

export function projectFinding(f: FindingLite): FindingOut {
  const out: FindingOut = {
    severity: f.severity,
    category: f.category,
    title: cut(f.title, TITLE_MAX),
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    rationale: cut(f.rationale, RATIONALE_MAX),
    confidence: f.confidence,
    state: findingState(f),
  };
  // A null suggestion is omitted (the output field is optional, not nullable).
  if (f.suggestion != null) out.suggestion = cut(f.suggestion, SUGGESTION_MAX);
  return out;
}

export function compareFindings(a: FindingLite, b: FindingLite): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.file.localeCompare(b.file) ||
    a.start_line - b.start_line
  );
}

export interface FindingsOptions {
  minSeverity?: SeverityName;
  limit: number;
}

/** Counts cover every finding; the severity filter and `limit` apply after. */
export function selectFindings(
  findings: readonly FindingLite[],
  opts: FindingsOptions,
): { counts: SeverityCounts; findings: FindingOut[]; truncated: boolean } {
  const floor = opts.minSeverity ? SEVERITY_RANK[opts.minSeverity] : SEVERITY_RANK.SUGGESTION;
  const kept = findings.filter((f) => SEVERITY_RANK[f.severity] <= floor).sort(compareFindings);
  return {
    counts: severityCounts(findings),
    findings: kept.slice(0, opts.limit).map(projectFinding),
    truncated: kept.length > opts.limit,
  };
}

// ---- review selection (get_findings) ---------------------------------------

export type ReviewSelection =
  | { kind: 'review'; review: ReviewLite }
  | { kind: 'running'; run: RunLite }
  | { kind: 'failed'; run: RunLite }
  | { kind: 'run_not_found' }
  | { kind: 'review_not_found'; run: RunLite }
  | { kind: 'none' };

/**
 * Without `runId`: the newest review (the API lists reviews `created_at desc`).
 * With `runId`: that run's phase decides; a done run selects its review.
 */
export function selectReview(
  runs: readonly RunLite[],
  reviews: readonly ReviewLite[],
  runId?: string,
): ReviewSelection {
  if (runId === undefined) {
    const newest = reviews[0];
    return newest ? { kind: 'review', review: newest } : { kind: 'none' };
  }
  const run = runs.find((r) => r.run_id === runId);
  if (!run) return { kind: 'run_not_found' };
  const phase = runPhase(run.status);
  if (phase === 'pending') return { kind: 'running', run };
  if (phase === 'failed') return { kind: 'failed', run };
  const review = reviews.find((r) => r.run_id === runId);
  return review ? { kind: 'review', review } : { kind: 'review_not_found', run };
}

export type NewerRun = { run_id: string; agent: string | null };

/**
 * The first pending run (runs are newest first) that started after the
 * selected review's own run. The anchor is that run's `ran_at`, falling back
 * to the review's `created_at` when the run is missing. A pending run with a
 * null `ran_at` counts as newer. With no review, any pending run counts.
 */
export function newerRunInProgress(runs: readonly RunLite[], review: ReviewLite | null): NewerRun | null {
  const pending = runs.filter((r) => runPhase(r.status) === 'pending');
  let candidate: RunLite | undefined;
  if (review === null) {
    candidate = pending[0];
  } else {
    const ownRun = review.run_id !== null ? runs.find((r) => r.run_id === review.run_id) : undefined;
    const anchor = Date.parse(ownRun?.ran_at ?? review.created_at);
    candidate = pending.find(
      (r) => r.run_id !== review.run_id && (r.ran_at === null || Date.parse(r.ran_at) > anchor),
    );
  }
  return candidate ? { run_id: candidate.run_id, agent: candidate.agent_name ?? null } : null;
}

const EMPTY_COUNTS: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };

function newerRunStep(newer: NewerRun): string {
  return `A newer run is in progress; call get_findings with run_id ${newer.run_id} later.`;
}

export function projectReviewFindings(
  review: ReviewLite,
  opts: FindingsOptions,
  newer: NewerRun | null,
): GetFindingsOutput {
  const out: GetFindingsOutput = {
    status: 'done',
    run_id: review.run_id,
    agent: review.agent_name ?? null,
    verdict: review.verdict,
    score: review.score,
    summary: review.summary === null ? null : cut(review.summary, SUMMARY_MAX),
    ...selectFindings(review.findings, opts),
    newer_run_in_progress: newer,
  };
  if (newer) out.next_step = newerRunStep(newer);
  return out;
}

export function projectRunningFindings(run: RunLite): GetFindingsOutput {
  return {
    status: 'running',
    run_id: run.run_id,
    agent: run.agent_name ?? null,
    verdict: null,
    score: null,
    summary: null,
    counts: { ...EMPTY_COUNTS },
    findings: [],
    truncated: false,
    newer_run_in_progress: null,
    next_step: `Run ${run.run_id} is still running; call get_findings with run_id ${run.run_id} again later.`,
  };
}

export function projectNoReview(newer: NewerRun | null): GetFindingsOutput {
  return {
    status: 'none',
    run_id: null,
    agent: null,
    verdict: null,
    score: null,
    summary: null,
    counts: { ...EMPTY_COUNTS },
    findings: [],
    truncated: false,
    newer_run_in_progress: newer,
    next_step: newer ? newerRunStep(newer) : 'This PR has no review yet; call run_agent_on_pr.',
  };
}

// ---- run_agent_on_pr -------------------------------------------------------

export interface RunResultBase {
  runId: string;
  agent: { id: string; name: string };
  repo: string;
  prNumber: number;
}

/** `run` null = still running when the wait budget ran out. */
export function projectRunResult(
  base: RunResultBase,
  run: RunLite | null,
  counts?: SeverityCounts,
): RunAgentOnPrOutput {
  const common = { run_id: base.runId, agent: base.agent, repo: base.repo, pr_number: base.prNumber };
  if (run === null) {
    return {
      ...common,
      status: 'running',
      duration_ms: null,
      findings_count: null,
      next_step: `The run is still in progress; call get_findings with run_id ${base.runId} later.`,
    };
  }
  const out: RunAgentOnPrOutput = {
    ...common,
    status: 'done',
    duration_ms: run.duration_ms,
    findings_count: run.findings_count,
    cost_usd: run.cost_usd ?? null,
    next_step: `Call get_findings with run_id ${base.runId} to read the findings.`,
  };
  if (counts) out.counts_by_severity = counts;
  return out;
}

// ---- get_conventions -------------------------------------------------------

export interface ConventionsOptions {
  status: 'accepted' | 'all';
  category?: string;
}

export function projectConventions(page: ConventionsLite, opts: ConventionsOptions): GetConventionsOutput {
  const kept = page.candidates.filter(
    (c) => (opts.status === 'all' || c.status === 'accepted') && (opts.category === undefined || c.category === opts.category),
  );
  const out: GetConventionsOutput = {
    scan: page.last_scan ? { status: page.last_scan.status, finished_at: page.last_scan.finished_at } : null,
    rules: kept.slice(0, CONVENTIONS_MAX).map((c) => ({
      category: c.category,
      rule: cut(c.rule, RULE_MAX),
      confidence: c.confidence,
      status: c.status,
      evidence: c.evidence.slice(0, EVIDENCE_MAX).map((e) => ({ path: e.path, line_start: e.line_start })),
    })),
    truncated: kept.length > CONVENTIONS_MAX,
  };
  if (out.rules.length === 0) {
    out.next_step = 'No matching conventions; run convention extraction for this repo in the DevDigest UI.';
  }
  return out;
}

// ---- get_blast_radius (stub) -----------------------------------------------

export const BLAST_RADIUS_NEXT_STEP =
  "Blast radius is not wired in this lab; open the PR's Overview tab in the DevDigest UI.";

export function blastRadiusStub(repo: string, prNumber: number): GetBlastRadiusOutput {
  return {
    status: 'not_implemented',
    reason: null,
    repo,
    pr_number: prNumber,
    summary: null,
    changed_symbols: [],
    downstream: [],
    truncated: false,
    next_step: BLAST_RADIUS_NEXT_STEP,
  };
}
