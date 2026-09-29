/**
 * APPLICATION — use cases of the `evals` module (plan Phase 3, ADR 0017/0018).
 * Depends on `domain.ts` and `ports.ts` only: no Drizzle, no Fastify, no
 * concrete repository, no container.
 *
 *  - cases: CRUD for a skill; the diff is snapshotted (paste or PR files)
 *  - suites: estimate (create) → guarded start → jobs → atomic close
 *  - runJob: the `container.evalJobs` handler body; it owns the run status
 *  - recoverOnBoot: fail orphaned runs, heal counters, re-enqueue queued runs
 *
 * Cancellation is cooperative: `cancelSuite` records the id in memory and the
 * running job's `checkCancelled` throws at the next chunk boundary. A call
 * already sent to the provider still finishes and is billed (ADR 0018). One
 * API process per DB is assumed, as in `ReviewService.reapStaleRuns`.
 */
import { EVAL_CASE_DIFF_MAX } from '@devdigest/shared';
import type {
  EvalCaseInputSource,
  EvalCaseSourceMeta,
  EvalExpectation,
  EvalSuiteCaseResult,
  EvalSuiteMode,
} from '@devdigest/shared';
import type { EvalCaseArmDetail, EvalCaseOutcome } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  armSkills,
  classifyCase,
  EVAL_CASE_HISTORY_MAX,
  expectationChangedSince,
  mapCaseArm,
  pickSuiteCases,
  assertEvalTrusted,
  assertJobLimit,
  assertWithinBudget,
  citationAccuracyOf,
  closingStatus,
  estimateJob,
  EVAL_ARMS,
  EVAL_REPEATS,
  EvalCancelledError,
  EvalCaseFileNotInPrError,
  EvalCarrierNotLinkedError,
  EvalNoCarrierError,
  EvalNoCasesError,
  EvalPriceUnknownError,
  EvalSuiteStaleError,
  expectationFilesOutsideDiff,
  jobTimeoutMs,
  pickDefaultCarrier,
  rankCarriers,
  scoreRun,
  skillsChars,
  suiteCost,
  summarizeSuite,
  totalJobsFor,
  unifiedDiffFromPatches,
  type EvalCase,
  type EvalCasePatch,
  type EvalRunRecord,
  type EvalRunResult,
  type EvalSuiteRecord,
  type EvalSuiteView,
} from './domain.js';
import { isPartialSuite } from '../_shared/eval-suite.js';
import type { ClaimedRun, EvalJobPayload, EvalsDeps, SuiteCounter } from './ports.js';
import { CANCELLED_RUN_ERROR, ORPHAN_RUN_ERROR, timedOutRunError } from './constants.js';

export interface CreateCaseInput {
  name: string;
  source: EvalCaseInputSource;
  expectation: EvalExpectation;
  notes?: string | null;
}

export type UpdateCaseInput = Partial<CreateCaseInput>;

export interface CreateSuiteInput {
  /** Omitted → the enabled-link agent with the most runs with the skill. Must link the skill (enabled). */
  carrierAgentId?: string;
  mode: EvalSuiteMode;
  /** Run only these cases (a per-case run); each must be a runnable case of the skill. */
  caseIds?: string[];
}

export interface EvalSuiteDetail {
  suite: EvalSuiteView;
  cases: EvalSuiteCaseResult[];
  runs: EvalRunRecord[];
}

/** `GET /eval-cases/:id`: the drawer's read model (arms are already wire-shaped). */
export interface EvalCaseDetailResult {
  case: EvalCase;
  suite: EvalSuiteView | null;
  arms: { with: EvalCaseArmDetail; without: EvalCaseArmDetail };
  outcome: EvalCaseOutcome | null;
  expectationChanged: boolean;
  history: { suite: EvalSuiteView; outcome: EvalCaseOutcome }[];
}

interface DiffSnapshot {
  inputDiff: string;
  inputFiles: string[];
  inputSource: EvalCaseSourceMeta;
}

export class EvalsService {
  /** Suites cancelled in this process; read synchronously by `checkCancelled`. */
  private readonly cancelled = new Set<string>();

  constructor(private readonly deps: EvalsDeps) {}

  // =========================================================================
  // Cases
  // =========================================================================

  /** undefined when the skill is not in this workspace. */
  async listCases(workspaceId: string, skillId: string): Promise<EvalCase[] | undefined> {
    const skill = await this.deps.store.findSkill(workspaceId, skillId);
    if (!skill) return undefined;
    return this.deps.store.listCases(workspaceId, skillId);
  }

  async createCase(workspaceId: string, skillId: string, input: CreateCaseInput): Promise<EvalCase | undefined> {
    const skill = await this.deps.store.findSkill(workspaceId, skillId);
    if (!skill) return undefined;
    const snapshot = await this.snapshotSource(workspaceId, input.source);
    this.assertExpectationFits(input.expectation, snapshot.inputFiles);
    return this.deps.store.insertCase({
      workspaceId,
      skillId,
      name: input.name,
      ...snapshot,
      expectation: input.expectation,
      notes: input.notes ?? null,
    });
  }

  /** A new `source` re-snapshots the diff; the expectation is re-checked against the diff it will run on. */
  async updateCase(workspaceId: string, id: string, input: UpdateCaseInput): Promise<EvalCase | undefined> {
    const existing = await this.deps.store.findCase(workspaceId, id);
    if (!existing || existing.ownerKind !== 'skill') return undefined;
    const snapshot = input.source ? await this.snapshotSource(workspaceId, input.source) : undefined;
    const files = snapshot?.inputFiles ?? this.deps.diffs.files(existing.inputDiff).map((f) => f.path);
    const expectation = input.expectation ?? existing.expectation;
    if (expectation && (input.expectation || snapshot)) this.assertExpectationFits(expectation, files);
    const patch: EvalCasePatch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(snapshot ?? {}),
      ...(input.expectation !== undefined ? { expectation: input.expectation } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    return this.deps.store.updateCase(workspaceId, id, patch);
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const existing = await this.deps.store.findCase(workspaceId, id);
    if (!existing || existing.ownerKind !== 'skill') return false;
    return this.deps.store.deleteCase(workspaceId, id);
  }

  private async snapshotSource(workspaceId: string, source: EvalCaseInputSource): Promise<DiffSnapshot> {
    if (source.kind === 'paste') {
      const files = this.deps.diffs.files(source.diff);
      if (files.length === 0) {
        throw new ValidationError('The pasted diff contains no file changes', { field: 'source.diff' });
      }
      return { inputDiff: source.diff, inputFiles: files.map((f) => f.path), inputSource: { kind: 'paste' } };
    }
    const pull = await this.deps.prs.getPull(workspaceId, source.pr_id);
    if (!pull) throw new NotFoundError('Pull request not found', { pr_id: source.pr_id });
    const prFiles = await this.deps.prs.getPrFiles(pull.id);
    const byPath = new Map(prFiles.map((f) => [f.path, f]));
    const wanted = [...new Set(source.files)];
    const missing = wanted.filter((p) => !byPath.has(p));
    if (missing.length > 0) throw new EvalCaseFileNotInPrError(missing, 'not_in_pr');
    const noPatch = wanted.filter((p) => !byPath.get(p)?.patch);
    if (noPatch.length > 0) throw new EvalCaseFileNotInPrError(noPatch, 'no_patch');
    const inputDiff = unifiedDiffFromPatches(wanted.map((path) => ({ path, patch: byPath.get(path)!.patch! })));
    // Same cap as a pasted diff: a case is a focused example, not a whole PR.
    if (inputDiff.length > EVAL_CASE_DIFF_MAX) {
      throw new ValidationError(`The selected files' diff exceeds ${EVAL_CASE_DIFF_MAX} characters`, {
        field: 'source.files',
        chars: inputDiff.length,
      });
    }
    return {
      inputDiff,
      inputFiles: wanted,
      inputSource: { kind: 'pr', pr_id: pull.id, pr_number: pull.number, head_sha: pull.headSha, files: wanted },
    };
  }

  /** An expectation naming a file outside the diff could never match: refuse it. */
  private assertExpectationFits(expectation: EvalExpectation, diffFiles: string[]): void {
    const outside = expectationFilesOutsideDiff(expectation, diffFiles);
    if (outside.length > 0) {
      throw new ValidationError(`Expectation names files that are not in the case diff: ${outside.join(', ')}`, {
        field: 'expectation',
        files: outside,
      });
    }
  }

  // =========================================================================
  // Suites
  // =========================================================================

  async listSuites(workspaceId: string, skillId: string): Promise<EvalSuiteView[] | undefined> {
    const skill = await this.deps.store.findSkill(workspaceId, skillId);
    if (!skill) return undefined;
    return this.deps.store.listSuites(workspaceId, skillId);
  }

  /** Eligible carriers, default first (undefined: skill not in this workspace). */
  async listCarriers(
    workspaceId: string,
    skillId: string,
  ): Promise<{ agentId: string; agentName: string; runs: number; isDefault: boolean }[] | undefined> {
    const skill = await this.deps.store.findSkill(workspaceId, skillId);
    if (!skill) return undefined;
    const ranked = rankCarriers(await this.deps.store.carrierCandidates(workspaceId, skillId));
    return ranked.map((c, i) => ({ ...c, isDefault: i === 0 }));
  }

  /**
   * Estimate only (ADR 0018 §4): freezes the prompt of both arms, prices
   * every job, applies the trust gate and the budget, and stores the suite in
   * `estimated` with one `queued` run per (case, arm, repeat). Nothing runs.
   */
  async createSuite(workspaceId: string, skillId: string, input: CreateSuiteInput): Promise<EvalSuiteView | undefined> {
    const { store } = this.deps;
    const skill = await store.findSkill(workspaceId, skillId);
    if (!skill) return undefined;
    // The target version IS the current version, so its body is the current body.
    assertEvalTrusted(skill, skill.bodySha256);

    // Eligible carriers = agents linking the skill with an enabled link. The
    // skill itself may be globally disabled: the eval pins the target body
    // explicitly (ADR 0018 amendment 2026-09-29).
    const candidates = await store.carrierCandidates(workspaceId, skillId);
    const carrierId = input.carrierAgentId ?? pickDefaultCarrier(candidates);
    if (!carrierId) throw new EvalNoCarrierError();
    const carrier = await store.findCarrier(workspaceId, carrierId);
    if (!carrier) throw new NotFoundError('Carrier agent not found', { carrier_agent_id: carrierId });
    if (!candidates.some((c) => c.agentId === carrier.id)) throw new EvalCarrierNotLinkedError(carrier.id);

    const runnable = (await store.listCases(workspaceId, skillId)).filter((c) => c.expectation !== null);
    if (runnable.length === 0) throw new EvalNoCasesError();
    const cases = pickSuiteCases(runnable, input.caseIds);
    const repeats = EVAL_REPEATS[input.mode];
    assertJobLimit(cases.length, repeats);

    const target = { id: skill.id, name: skill.name, body: skill.body };
    const carrierSkills = await this.deps.skills.effectiveSkills(carrier.id);
    const withSkills = armSkills(carrierSkills, target, 'with');

    let estimateUsd = 0;
    for (const c of cases) {
      const files = this.deps.diffs.files(c.inputDiff);
      for (const arm of EVAL_ARMS) {
        const job = estimateJob({
          systemPrompt: carrier.systemPrompt,
          skillsChars: skillsChars(armSkills(carrierSkills, target, arm)),
          diffChars: c.inputDiff.length,
          files,
          strategy: carrier.strategy,
        });
        const cost = this.deps.price(carrier.model, job.tokensIn, job.tokensOut);
        if (cost === null) throw new EvalPriceUnknownError(carrier.model);
        estimateUsd += cost * repeats;
      }
    }
    assertWithinBudget(estimateUsd, this.deps.maxBudgetUsd);

    return store.insertSuite(
      {
        workspaceId,
        skillId,
        skillVersion: skill.version,
        promptSha256: skill.promptSha256,
        carrierAgentId: carrier.id,
        carrierAgentVersion: carrier.version,
        carrierAgentName: carrier.name,
        model: carrier.model,
        runConfig: {
          provider: carrier.provider,
          systemPrompt: carrier.systemPrompt,
          strategy: carrier.strategy,
          withSkills,
        },
        mode: input.mode,
        repeats,
        totalJobs: totalJobsFor(cases.length, repeats),
        estimateUsd,
        caseIds: input.caseIds === undefined ? null : cases.map((c) => c.id),
      },
      cases.map((c) => c.id),
    );
  }

  /**
   * ADR 0018 two-step start. Past `estimated` → 200 with the current state,
   * nothing started (replay no-op). Stale (prompt or carrier moved) → 409.
   * Another running suite in the workspace → 409 (DB partial unique index).
   */
  async startSuite(workspaceId: string, id: string): Promise<EvalSuiteView | undefined> {
    const { store } = this.deps;
    const view = await store.findSuite(workspaceId, id);
    if (!view) return undefined;
    if (view.status !== 'estimated') return view;
    if (view.stale) throw new EvalSuiteStaleError();

    const started = await store.startSuite(workspaceId, id);
    if (!started) return store.findSuite(workspaceId, id); // lost a race: someone else moved it

    if (started.totalJobs === 0) {
      await store.closeSuite(id, { ...closingStatus([]), results: null, costUsd: null, costSource: null });
    } else {
      await this.enqueueRuns(
        workspaceId,
        started,
        (await store.listRuns(id)).filter((r) => r.status === 'queued').map((r) => ({ runId: r.id, caseId: r.caseId })),
      );
    }
    return store.findSuite(workspaceId, id);
  }

  /** Estimated/running → cancelled. On a terminal suite a 200 no-op. */
  async cancelSuite(workspaceId: string, id: string): Promise<EvalSuiteView | undefined> {
    const view = await this.deps.store.findSuite(workspaceId, id);
    if (!view) return undefined;
    const cancelled = await this.deps.store.cancelSuite(workspaceId, id);
    if (cancelled) this.cancelled.add(id);
    return this.deps.store.findSuite(workspaceId, id);
  }

  /** The polling target: suite + per-case table (computed live) + every run. */
  async getSuiteDetail(workspaceId: string, id: string): Promise<EvalSuiteDetail | undefined> {
    const suite = await this.deps.store.findSuite(workspaceId, id);
    if (!suite) return undefined;
    const [runs, cases] = await Promise.all([this.deps.store.listRuns(id), this.deps.store.suiteCases(id)]);
    const { cases: rows, results } = summarizeSuite({
      mode: suite.mode,
      repeats: suite.repeats,
      cases,
      runs,
      partial: isPartialSuite(suite),
    });
    // Header and rows share ONE derivation. The stored `results` column can
    // predate a summary change (e.g. `errored`), so a done suite with runs
    // reports the live figures; the column itself is never rewritten here.
    const live = suite.status === 'done' && suite.results && runs.length > 0 ? results : suite.results;
    return { suite: { ...suite, results: live }, cases: rows, runs };
  }

  /**
   * The drawer read model. The suite is the requested one (it must contain the
   * case, else 404) or the latest started suite containing it; a case that
   * never ran has `suite: null` and empty arms. Undefined = unknown case.
   */
  async getCaseDetail(
    workspaceId: string,
    caseId: string,
    opts: { suiteId?: string },
  ): Promise<EvalCaseDetailResult | undefined> {
    const { store } = this.deps;
    const evalCase = await store.findCase(workspaceId, caseId);
    if (!evalCase || evalCase.ownerKind !== 'skill') return undefined;

    const history = await store.caseSuites(workspaceId, caseId, EVAL_CASE_HISTORY_MAX);
    const summary = history.map((h) => ({ suite: h.suite, outcome: classifyCase(h.runs, h.suite.repeats).outcome }));

    let suite: EvalSuiteView | undefined;
    if (opts.suiteId !== undefined) {
      suite = await store.findSuite(workspaceId, opts.suiteId);
      if (!suite) throw new NotFoundError('Eval suite not found');
    } else {
      suite = history[0]?.suite;
    }
    if (!suite) {
      const empty = mapCaseArm([], 'with', 0, evalCase.expectation);
      return {
        case: evalCase,
        suite: null,
        arms: { with: empty, without: mapCaseArm([], 'without', 0, evalCase.expectation) },
        outcome: null,
        expectationChanged: false,
        history: summary,
      };
    }

    const runs = await store.listCaseRuns(suite.id, caseId);
    if (runs.length === 0) throw new NotFoundError('Eval suite not found');
    return {
      case: evalCase,
      suite,
      arms: {
        with: mapCaseArm(runs, 'with', suite.repeats, evalCase.expectation),
        without: mapCaseArm(runs, 'without', suite.repeats, evalCase.expectation),
      },
      outcome: classifyCase(runs, suite.repeats).outcome,
      expectationChanged: expectationChangedSince(evalCase.updatedAt, suite.startedAt ?? suite.createdAt),
      history: summary,
    };
  }

  private async enqueueRuns(
    workspaceId: string,
    suite: Pick<EvalSuiteRecord, 'id' | 'skillId' | 'runConfig'>,
    runs: { runId: string; caseId: string }[],
  ): Promise<void> {
    const cases = new Map((await this.deps.store.listCases(workspaceId, suite.skillId)).map((c) => [c.id, c]));
    for (const r of runs) {
      const diff = cases.get(r.caseId)?.inputDiff ?? '';
      const { chunks } = estimateJob({
        systemPrompt: '',
        skillsChars: 0,
        diffChars: 0,
        files: this.deps.diffs.files(diff),
        strategy: suite.runConfig.strategy,
      });
      await this.deps.queue.enqueue(workspaceId, { suiteId: suite.id, runId: r.runId }, jobTimeoutMs(chunks));
    }
  }

  // =========================================================================
  // Job handler (driven by container.evalJobs; never throws)
  // =========================================================================

  /**
   * One (case, arm, repeat). Claim (queued → running) makes a duplicate job a
   * no-op; the first terminal transition is the one that counts toward
   * `done_jobs`; the handler that brings `done_jobs` to `total_jobs` closes
   * the suite. A run deleted with its case still counts, so the suite closes.
   */
  async runJob(payload: EvalJobPayload): Promise<void> {
    const { store, log } = this.deps;
    try {
      const claim = await store.claimRun(payload.runId);
      if (!claim) {
        if (!(await store.runExists(payload.runId))) await this.countJob(payload.suiteId);
        return;
      }
      const result = await this.execute(claim);
      const first = await store.finishRun(payload.runId, result);
      if (first) await this.countJob(payload.suiteId);
    } catch (err) {
      // The run stays `running`; boot recovery fails it and heals the counter.
      log?.error({ err: (err as Error).message, ...payload }, 'eval job: bookkeeping failed');
    }
  }

  /**
   * The job runner gave up on a job (its per-job timeout fired, ADR 0018).
   * The model call may still be in flight and cannot be stopped, but the run
   * must not stay `running` until the next boot: that would hold the suite
   * open and, through the one-running-suite index, block the workspace. Fail
   * it now and count it once; a late answer still lands via `finishRun`
   * (failed → done) without being counted again.
   */
  async timeOutJob(payload: EvalJobPayload, timeoutMs: number): Promise<void> {
    try {
      const first = await this.deps.store.finishRun(payload.runId, {
        status: 'failed',
        error: timedOutRunError(timeoutMs),
        durationMs: timeoutMs,
      });
      if (first) await this.countJob(payload.suiteId);
    } catch (err) {
      this.deps.log?.error({ err: (err as Error).message, ...payload }, 'eval job: timeout bookkeeping failed');
    }
  }

  private async execute({ run, suite, evalCase }: ClaimedRun): Promise<EvalRunResult> {
    const start = Date.now();
    const failed = (error: string): EvalRunResult => ({ status: 'failed', error, durationMs: Date.now() - start });
    if (suite.status !== 'running' || this.cancelled.has(suite.id)) {
      return failed(suite.status === 'cancelled' || this.cancelled.has(suite.id) ? CANCELLED_RUN_ERROR : `Suite is ${suite.status}`);
    }
    if (!evalCase?.expectation) return failed('The case has no valid expectation any more');

    const cfg = suite.runConfig;
    const skills = run.arm === 'with' ? cfg.withSkills : cfg.withSkills.filter((s) => s.id !== suite.skillId);
    try {
      const out = await this.deps.reviewer.review({
        provider: cfg.provider,
        model: suite.model,
        systemPrompt: cfg.systemPrompt,
        strategy: cfg.strategy,
        diffRaw: evalCase.inputDiff,
        skills,
        task: `Review the change in eval case "${evalCase.name}".`,
        sessionId: `eval:${suite.id}:${evalCase.id}:${run.arm}:${run.repeatIdx}`,
        checkCancelled: () => {
          if (this.cancelled.has(suite.id)) throw new EvalCancelledError();
        },
      });
      const score = scoreRun(out.findings, evalCase.expectation);
      const priced = out.costUsd !== null && out.costSource !== null;
      return {
        status: 'done',
        ...score,
        citationAccuracy: citationAccuracyOf(out.grounding),
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        costUsd: priced ? out.costUsd : null,
        costSource: priced ? out.costSource : null,
        durationMs: Date.now() - start,
        actualOutput: { findings: out.findings, grounding: out.grounding },
      };
    } catch (err) {
      return failed(err instanceof EvalCancelledError ? CANCELLED_RUN_ERROR : (err as Error).message);
    }
  }

  /** Atomic counter; exactly one caller sees `done_jobs` reach `total_jobs`. */
  private async countJob(suiteId: string): Promise<void> {
    const counter = await this.deps.store.countJob(suiteId);
    if (counter) await this.closeIfComplete(suiteId, counter);
  }

  private async closeIfComplete(suiteId: string, c: SuiteCounter): Promise<void> {
    if (c.status !== 'running' || c.doneJobs < c.totalJobs) return;
    const [runs, cases] = await Promise.all([this.deps.store.listRuns(suiteId), this.deps.store.suiteCases(suiteId)]);
    const closing = closingStatus(runs);
    const { results } = summarizeSuite({ mode: c.mode, repeats: c.repeats, cases, runs, partial: c.partial });
    await this.deps.store.closeSuite(suiteId, {
      ...closing,
      results: closing.status === 'done' ? results : null,
      ...suiteCost(runs),
    });
    this.deps.log?.info({ suiteId, status: closing.status, verdict: results.verdict }, 'eval suite closed');
  }

  // =========================================================================
  // Boot recovery (ADR 0018 §8)
  // =========================================================================

  /**
   * A fresh process has no jobs in flight, so every `running` run is an
   * orphan: it becomes failed. Counters of running suites are then healed
   * from the runs themselves (covers a crash between writing a result and
   * counting it), complete suites close, and queued runs are re-enqueued.
   */
  async recoverOnBoot(): Promise<{ orphaned: number; requeued: number; closed: number }> {
    const { store } = this.deps;
    const orphans = await store.failOrphanRuns(ORPHAN_RUN_ERROR);
    const counters = await store.reconcileRunningSuites();
    let closed = 0;
    for (const c of counters) {
      if (c.doneJobs >= c.totalJobs) {
        await this.closeIfComplete(c.suiteId, c);
        closed++;
      }
    }
    const queued = await store.queuedRunsOfRunningSuites();
    const bySuite = new Map<string, typeof queued>();
    for (const q of queued) bySuite.set(q.suiteId, [...(bySuite.get(q.suiteId) ?? []), q]);
    for (const [suiteId, runs] of bySuite) {
      const first = runs[0]!;
      await this.enqueueRuns(
        first.workspaceId,
        { id: suiteId, skillId: first.skillId, runConfig: first.runConfig },
        runs,
      );
    }
    return { orphaned: orphans.length, requeued: queued.length, closed };
  }
}
