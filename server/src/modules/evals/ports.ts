/**
 * PORTS — what `EvalsService` needs from the outside world. `repository.ts`
 * implements `EvalStore` with Drizzle; `wiring.ts` adapts the container's
 * shared seams (`reviewRepo`, `skillsRepo`, `llm`, `priceBook`, `evalJobs`)
 * to the rest. The service unit tests implement every port in memory.
 */
import type { CostSource, Finding } from '@devdigest/shared';
import type {
  CarrierCandidate,
  DiffFileStat,
  EvalCarrier,
  EvalCase,
  EvalCasePatch,
  EvalRunRecord,
  EvalRunResult,
  EvalSkillText,
  EvalSuiteRecord,
  EvalSuiteView,
  EvalTargetSkill,
  NewEvalCase,
  NewEvalSuite,
} from './domain.js';

/** A run the handler claimed (queued → running), with what it needs to execute. */
export interface ClaimedRun {
  run: EvalRunRecord;
  suite: EvalSuiteRecord;
  evalCase: EvalCase | undefined;
}

export interface SuiteCounter {
  doneJobs: number;
  totalJobs: number;
  status: EvalSuiteRecord['status'];
  mode: EvalSuiteRecord['mode'];
  repeats: number;
}

/** A queued run of a running suite, with what re-enqueueing it needs. */
export interface QueuedRun {
  runId: string;
  caseId: string;
  suiteId: string;
  workspaceId: string;
  skillId: string;
  runConfig: EvalSuiteRecord['runConfig'];
}

export interface EvalStore {
  // ---- reads of other modules' tables (skills / agents / runs)
  findSkill(workspaceId: string, skillId: string): Promise<EvalTargetSkill | undefined>;
  findCarrier(workspaceId: string, agentId: string): Promise<EvalCarrier | undefined>;
  /** Agents linking the skill, with their completed runs that injected it. */
  carrierCandidates(workspaceId: string, skillId: string): Promise<CarrierCandidate[]>;

  // ---- cases
  listCases(workspaceId: string, skillId: string): Promise<EvalCase[]>;
  findCase(workspaceId: string, id: string): Promise<EvalCase | undefined>;
  insertCase(input: NewEvalCase): Promise<EvalCase>;
  updateCase(workspaceId: string, id: string, patch: EvalCasePatch): Promise<EvalCase | undefined>;
  deleteCase(workspaceId: string, id: string): Promise<boolean>;

  // ---- suites
  /** The suite and one `queued` run per (case, arm, repeat), atomically. */
  insertSuite(input: NewEvalSuite, caseIds: string[]): Promise<EvalSuiteView>;
  listSuites(workspaceId: string, skillId: string): Promise<EvalSuiteView[]>;
  findSuite(workspaceId: string, id: string): Promise<EvalSuiteView | undefined>;
  /**
   * ADR 0018 two-step start: ONE guarded `UPDATE … WHERE status='estimated'`.
   * `total_jobs` is re-counted from the suite's runs in the same statement.
   * Returns undefined when the guard missed (already started / cancelled);
   * throws `EvalSuiteBusyError` when another suite is running.
   */
  startSuite(workspaceId: string, id: string): Promise<EvalSuiteRecord | undefined>;
  /** Estimated/running → cancelled; undefined when already terminal (no-op). */
  cancelSuite(workspaceId: string, id: string): Promise<EvalSuiteRecord | undefined>;
  listRuns(suiteId: string): Promise<EvalRunRecord[]>;
  /** Cases of a suite (id + name), including ones whose runs were all deleted. */
  suiteCases(suiteId: string): Promise<{ id: string; name: string }[]>;

  // ---- job lifecycle (handler-owned status, ADR 0018 §2-3)
  /** queued → running. Undefined when the run is missing or already claimed. */
  claimRun(runId: string): Promise<ClaimedRun | undefined>;
  runExists(runId: string): Promise<boolean>;
  /**
   * Write a job's result. Returns true only on the FIRST terminal transition
   * (running → done/failed); that is the one caller that counts the job. A
   * late `done` for a run already marked failed still lands (the upsert
   * "honestly becomes done") but returns false: it was counted already.
   */
  finishRun(runId: string, result: EvalRunResult): Promise<boolean>;
  /** Atomic `done_jobs = done_jobs + 1 … RETURNING`. */
  countJob(suiteId: string): Promise<SuiteCounter | undefined>;
  /** Running → done/failed with results + cost. False when not running any more. */
  closeSuite(
    suiteId: string,
    patch: {
      status: 'done' | 'failed';
      results: EvalSuiteRecord['results'];
      costUsd: number | null;
      costSource: CostSource | null;
      error: string | null;
    },
  ): Promise<boolean>;

  // ---- boot recovery (ADR 0018 §8)
  /** Runs of running suites left `running` by a dead process → failed. */
  failOrphanRuns(error: string): Promise<{ runId: string; suiteId: string }[]>;
  /**
   * Running suites' counters recomputed from their runs (done = terminal
   * runs, total = existing runs). Safe only when no job is in flight (boot).
   */
  reconcileRunningSuites(): Promise<(SuiteCounter & { suiteId: string })[]>;
  /** Queued runs of running suites, to re-enqueue. */
  queuedRunsOfRunningSuites(): Promise<QueuedRun[]>;
}

/** Synced PR data, through `container.reviewRepo` (never the pulls module). */
export interface EvalPrSource {
  getPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; number: number; headSha: string } | undefined>;
  getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]>;
}

/** The carrier's effective skills right now (`container.skillsRepo`). */
export interface EvalSkillResolver {
  effectiveSkills(agentId: string): Promise<EvalSkillText[]>;
}

export interface DiffParser {
  /** Files of a unified diff; empty when nothing parses. */
  files(raw: string): DiffFileStat[];
}

export interface EvalReviewInput {
  provider: EvalCarrier['provider'];
  model: string;
  systemPrompt: string;
  strategy: EvalCarrier['strategy'];
  diffRaw: string;
  skills: EvalSkillText[];
  task: string;
  sessionId: string;
  /** Throws to abort before the next chunk (cooperative cancel). */
  checkCancelled: () => void;
}

export interface EvalReviewOutput {
  findings: Finding[];
  grounding: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  costSource: CostSource | null;
  raw: string;
}

/** One carrier review of a case diff (`reviewPullRequest` in production). */
export interface EvalReviewer {
  review(input: EvalReviewInput): Promise<EvalReviewOutput>;
}

export interface EvalJobPayload {
  suiteId: string;
  runId: string;
}

export interface EvalJobQueue {
  enqueue(workspaceId: string, payload: EvalJobPayload, timeoutMs: number): Promise<void>;
}

/** Cost of `tokensIn`/`tokensOut` on `model`; null = no price entry. */
export type PriceEstimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

export interface EvalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface EvalsDeps {
  store: EvalStore;
  prs: EvalPrSource;
  skills: EvalSkillResolver;
  diffs: DiffParser;
  reviewer: EvalReviewer;
  queue: EvalJobQueue;
  price: PriceEstimator;
  maxBudgetUsd: number;
  log?: EvalLogger;
}
