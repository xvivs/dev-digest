/**
 * The eval-suite read model shared by two modules: `evals` (suite routes) and
 * `skills` (the Stats tab's `impact` block). Modules never import each other,
 * so the view shape, its one verdict rule for the impact block and its wire
 * mapper live here. Pure: types from `@devdigest/shared`, no I/O.
 */
import type {
  CostSource,
  EvalSuite as EvalSuiteDto,
  EvalSuiteMode,
  EvalSuiteResults,
  EvalSuiteStatus,
  ImpactVerdict,
} from '@devdigest/shared';

/** A persisted suite plus what a read derives: current carrier name and staleness. */
export interface EvalSuiteView {
  id: string;
  workspaceId: string;
  skillId: string;
  skillVersion: number;
  promptSha256: string;
  carrierAgentId: string;
  carrierAgentVersion: number;
  /** Carrier's CURRENT name; null once the agent is deleted. */
  carrierName: string | null;
  model: string;
  mode: EvalSuiteMode;
  repeats: number;
  status: EvalSuiteStatus;
  totalJobs: number;
  doneJobs: number;
  estimateUsd: number;
  costUsd: number | null;
  costSource: CostSource | null;
  /** ADR 0017: the skill's prompt_sha256 or the carrier's version moved since. */
  stale: boolean;
  results: EvalSuiteResults | null;
  error: string | null;
  /** Cases a per-case suite covers; null = the skill's whole runnable set (see `isPartialSuite`). */
  caseIds: string[] | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * Verdict shown for a suite in the Stats impact block: the stored verdict
 * once the suite is `done`, `unknown` while it has not finished (or never
 * will: failed / cancelled).
 */
export function suiteImpactVerdict(suite: Pick<EvalSuiteView, 'status' | 'results'>): ImpactVerdict {
  return suite.status === 'done' && suite.results ? suite.results.verdict : 'unknown';
}

/** A per-case suite lacks the full case set, so it is never an Impact / latest-verdict source. */
export function isPartialSuite(suite: Pick<EvalSuiteView, 'caseIds'>): boolean {
  return suite.caseIds !== null;
}

export function toEvalSuiteDto(s: EvalSuiteView): EvalSuiteDto {
  return {
    id: s.id,
    skill_id: s.skillId,
    skill_version: s.skillVersion,
    prompt_sha256: s.promptSha256,
    carrier_agent_id: s.carrierAgentId,
    carrier_agent_version: s.carrierAgentVersion,
    carrier_name: s.carrierName,
    model: s.model,
    mode: s.mode,
    repeats: s.repeats,
    status: s.status,
    total_jobs: s.totalJobs,
    done_jobs: s.doneJobs,
    estimate_usd: s.estimateUsd,
    cost_usd: s.costUsd,
    cost_source: s.costSource,
    stale: s.stale,
    results: s.results,
    error: s.error,
    case_ids: s.caseIds,
    partial: isPartialSuite(s),
    created_at: s.createdAt.toISOString(),
    started_at: s.startedAt?.toISOString() ?? null,
    finished_at: s.finishedAt?.toISOString() ?? null,
  };
}
