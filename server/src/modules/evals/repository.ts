/**
 * INFRASTRUCTURE — Drizzle implementation of `EvalStore`. The only file in
 * the module that imports `drizzle-orm` or `db/**`. Rows never leave this
 * file: they are mapped to the domain shapes in `domain.ts`.
 *
 * Also owns `findImpactSuite`, a cross-cutting read the skills Stats tab uses
 * through `container.evalsRepo` (never by a direct module import).
 *
 * Legacy tolerance: `eval_cases.expected_output` / `input_meta` are parsed
 * with the contract schemas on read; a legacy row that does not parse maps
 * to `expectation: null` / `inputSource: null` instead of failing the read.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { EvalCaseSourceMeta, EvalExpectation, EvalSuiteResults } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import {
  EVAL_ARMS,
  EvalSuiteBusyError,
  isSuiteStale,
  type CarrierCandidate,
  type CaseRunWithOutput,
  type EvalCarrier,
  type EvalCase,
  type EvalCasePatch,
  type EvalRunConfig,
  type EvalRunRecord,
  type EvalRunResult,
  type EvalSuiteRecord,
  type EvalSuiteView,
  type EvalTargetSkill,
  type NewEvalCase,
  type NewEvalSuite,
} from './domain.js';
import type { ClaimedRun, EvalStore, QueuedRun, SuiteCounter } from './ports.js';
import { CANCELLED_RUN_ERROR, COMPLETED_RUN_STATUS } from './constants.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type CaseRow = typeof t.evalCases.$inferSelect;
type SuiteRow = typeof t.evalSuites.$inferSelect;
type RunRow = typeof t.evalRuns.$inferSelect;

const ONE_RUNNING_UQ = 'eval_suites_one_running_per_workspace_uq';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SQL twin of `sha256(promptHashInput(name, body))` (skills/domain.ts): name + "\n" + body. */
const CURRENT_PROMPT_SHA256 = sql<string>`encode(sha256(convert_to(${t.skills.name} || chr(10) || ${t.skills.body}, 'UTF8')), 'hex')`;

/** SQL twin of `isPartialSuite`: a per-case suite has `case_ids` set. */
const PARTIAL_SUITE = sql<boolean>`(${t.evalSuites.caseIds} IS NOT NULL)`;

function isUniqueViolation(err: unknown, constraint: string): boolean {
  // drizzle may wrap the driver error; check both levels.
  const probe = (e: unknown) =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === '23505' &&
    (e as { constraint_name?: unknown }).constraint_name === constraint;
  return probe(err) || probe((err as { cause?: unknown })?.cause);
}

function toCase(row: CaseRow): EvalCase {
  const expectation = EvalExpectation.safeParse(row.expectedOutput);
  const source = EvalCaseSourceMeta.safeParse(row.inputMeta);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    skillId: row.skillId,
    name: row.name,
    inputDiff: row.inputDiff ?? '',
    inputFiles: row.inputFiles,
    inputMeta: row.inputMeta,
    expectedOutput: row.expectedOutput,
    expectation: expectation.success ? expectation.data : null,
    inputSource: source.success ? source.data : null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSuite(row: SuiteRow): EvalSuiteRecord {
  const results = EvalSuiteResults.safeParse(row.results);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    skillId: row.skillId,
    skillVersion: row.skillVersion,
    promptSha256: row.promptSha256,
    carrierAgentId: row.carrierAgentId,
    carrierAgentVersion: row.carrierAgentVersion,
    carrierAgentName: row.carrierAgentName,
    model: row.model,
    runConfig: row.runConfig as EvalRunConfig,
    mode: row.mode,
    repeats: row.repeats,
    status: row.status,
    totalJobs: row.totalJobs,
    doneJobs: row.doneJobs,
    estimateUsd: row.estimateUsd,
    costUsd: row.costUsd,
    costSource: row.costSource,
    results: results.success ? results.data : null,
    error: row.error,
    caseIds: row.caseIds ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function toRun(row: RunRow): EvalRunRecord {
  const done = row.status === 'done' || row.status === 'failed';
  return {
    id: row.id,
    suiteId: row.suiteId ?? '',
    caseId: row.caseId,
    arm: row.arm ?? 'with',
    repeatIdx: row.repeatIdx ?? 0,
    status: row.status ?? 'queued',
    pass: row.pass,
    matched: row.matched,
    expected: row.expected,
    unexpected: row.unexpected,
    citationAccuracy: row.citationAccuracy,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    costSource: row.costSource,
    durationMs: row.durationMs,
    error: row.error,
    // `ran_at` defaults to the insert time; it means "finished at" only once terminal.
    ranAt: done ? row.ranAt : null,
  };
}

export class EvalsRepository implements EvalStore {
  constructor(private readonly db: Db | Tx) {}

  // ---- reads of skills / agents / runs

  async findSkill(workspaceId: string, skillId: string): Promise<EvalTargetSkill | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      body: row.body,
      version: row.version,
      source: row.source,
      vettedBodyHash: row.vettedBodyHash,
      bodySha256: sha256Hex(row.body),
      promptSha256: sha256Hex(`${row.name}\n${row.body}`),
    };
  }

  async findCarrier(workspaceId: string, agentId: string): Promise<EvalCarrier | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      provider: row.provider,
      model: row.model,
      systemPrompt: row.systemPrompt,
      strategy: row.strategy,
    };
  }

  /** Agents linking the skill with the link enabled (`agent_skills.enabled`); a disabled link is not a carrier. */
  async carrierCandidates(workspaceId: string, skillId: string): Promise<CarrierCandidate[]> {
    const runs = this.db
      .select({ agentId: t.agentRuns.agentId, runs: sql<number>`count(*)::int`.as('runs') })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkills.runId))
      .where(
        and(
          eq(t.runSkills.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, COMPLETED_RUN_STATUS),
        ),
      )
      .groupBy(t.agentRuns.agentId)
      .as('carrier_runs');
    const rows = await this.db
      .select({ agentId: t.agents.id, agentName: t.agents.name, runs: sql<number>`coalesce(${runs.runs}, 0)::int` })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .leftJoin(runs, eq(runs.agentId, t.agents.id))
      .where(
        and(
          eq(t.agentSkills.skillId, skillId),
          eq(t.agentSkills.enabled, true),
          eq(t.agents.workspaceId, workspaceId),
        ),
      );
    return rows.map((r) => ({ ...r, runs: Number(r.runs) }));
  }

  // ---- cases

  async listCases(workspaceId: string, skillId: string): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.skillId, skillId)))
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.id));
    return rows.map(toCase);
  }

  async findCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row ? toCase(row) : undefined;
  }

  async insertCase(input: NewEvalCase): Promise<EvalCase> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: input.workspaceId,
        ownerKind: 'skill',
        ownerId: input.skillId,
        skillId: input.skillId,
        name: input.name,
        inputDiff: input.inputDiff,
        inputFiles: input.inputFiles,
        inputMeta: input.inputSource,
        expectedOutput: input.expectation,
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('insert into eval_cases returned no row');
    return toCase(row);
  }

  async updateCase(workspaceId: string, id: string, patch: EvalCasePatch): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputSource !== undefined ? { inputMeta: patch.inputSource } : {}),
        ...(patch.expectation !== undefined ? { expectedOutput: patch.expectation } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row ? toCase(row) : undefined;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- suites

  async insertSuite(input: NewEvalSuite, caseIds: string[]): Promise<EvalSuiteView> {
    const id = await this.db.transaction(async (tx) => {
      const [suite] = await tx
        .insert(t.evalSuites)
        .values({
          workspaceId: input.workspaceId,
          skillId: input.skillId,
          skillVersion: input.skillVersion,
          promptSha256: input.promptSha256,
          carrierAgentId: input.carrierAgentId,
          carrierAgentVersion: input.carrierAgentVersion,
          carrierAgentName: input.carrierAgentName,
          model: input.model,
          runConfig: input.runConfig,
          mode: input.mode,
          repeats: input.repeats,
          totalJobs: input.totalJobs,
          estimateUsd: input.estimateUsd,
          caseIds: input.caseIds,
        })
        .returning({ id: t.evalSuites.id });
      if (!suite) throw new Error('insert into eval_suites returned no row');
      const runs = caseIds.flatMap((caseId) =>
        EVAL_ARMS.flatMap((arm) =>
          Array.from({ length: input.repeats }, (_, repeatIdx) => ({
            workspaceId: input.workspaceId,
            suiteId: suite.id,
            caseId,
            arm,
            repeatIdx,
            status: 'queued' as const,
          })),
        ),
      );
      // Idempotency key: the same (suite, case, arm, repeat) can never exist twice.
      if (runs.length > 0) await tx.insert(t.evalRuns).values(runs).onConflictDoNothing();
      return suite.id;
    });
    const view = await this.findSuite(input.workspaceId, id);
    if (!view) throw new Error('eval suite vanished right after insert');
    return view;
  }

  private suiteViews() {
    return this.db
      .select({
        suite: t.evalSuites,
        carrierName: t.agents.name,
        carrierVersion: t.agents.version,
        currentPromptSha256: CURRENT_PROMPT_SHA256,
      })
      .from(t.evalSuites)
      .innerJoin(t.skills, eq(t.skills.id, t.evalSuites.skillId))
      .leftJoin(t.agents, eq(t.agents.id, t.evalSuites.carrierAgentId))
      .$dynamic();
  }

  private toView(r: {
    suite: SuiteRow;
    carrierName: string | null;
    carrierVersion: number | null;
    currentPromptSha256: string;
  }): EvalSuiteView {
    const s = toSuite(r.suite);
    const { runConfig: _config, carrierAgentName: _name, ...rest } = s;
    return {
      ...rest,
      carrierName: r.carrierName,
      stale: isSuiteStale(s, { promptSha256: r.currentPromptSha256, carrierVersion: r.carrierVersion }),
    };
  }

  async listSuites(workspaceId: string, skillId: string): Promise<EvalSuiteView[]> {
    const rows = await this.suiteViews()
      .where(and(eq(t.evalSuites.workspaceId, workspaceId), eq(t.evalSuites.skillId, skillId)))
      .orderBy(desc(t.evalSuites.createdAt), desc(t.evalSuites.id));
    return rows.map((r) => this.toView(r));
  }

  async findSuite(workspaceId: string, id: string): Promise<EvalSuiteView | undefined> {
    const [row] = await this.suiteViews().where(
      and(eq(t.evalSuites.workspaceId, workspaceId), eq(t.evalSuites.id, id)),
    );
    return row ? this.toView(row) : undefined;
  }

  /**
   * Stats tab `impact` (SkillImpact.suite): the latest done Full suite, else
   * the latest suite of any mode or status. One query. Per-case suites
   * (`case_ids` set) are excluded: they lack the full case set, so they are
   * never a verdict source (ADR 0017).
   */
  async findImpactSuite(workspaceId: string, skillId: string): Promise<EvalSuiteView | undefined> {
    const [row] = await this.suiteViews()
      .where(
        and(
          eq(t.evalSuites.workspaceId, workspaceId),
          eq(t.evalSuites.skillId, skillId),
          isNull(t.evalSuites.caseIds),
        ),
      )
      .orderBy(
        desc(sql`(${t.evalSuites.mode} = 'full' AND ${t.evalSuites.status} = 'done')`),
        desc(t.evalSuites.finishedAt),
        desc(t.evalSuites.createdAt),
      )
      .limit(1);
    return row ? this.toView(row) : undefined;
  }

  async startSuite(workspaceId: string, id: string): Promise<EvalSuiteRecord | undefined> {
    try {
      const [row] = await this.db
        .update(t.evalSuites)
        .set({
          status: 'running',
          startedAt: new Date(),
          // Re-counted: a case deleted since the estimate took its runs with it.
          totalJobs: sql`(SELECT count(*)::int FROM ${t.evalRuns} WHERE ${t.evalRuns.suiteId} = ${t.evalSuites.id})`,
        })
        .where(
          and(
            eq(t.evalSuites.id, id),
            eq(t.evalSuites.workspaceId, workspaceId),
            eq(t.evalSuites.status, 'estimated'),
          ),
        )
        .returning();
      return row ? toSuite(row) : undefined;
    } catch (err) {
      if (isUniqueViolation(err, ONE_RUNNING_UQ)) throw new EvalSuiteBusyError();
      throw err;
    }
  }

  async cancelSuite(workspaceId: string, id: string): Promise<EvalSuiteRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(t.evalSuites)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          and(
            eq(t.evalSuites.id, id),
            eq(t.evalSuites.workspaceId, workspaceId),
            inArray(t.evalSuites.status, ['estimated', 'running']),
          ),
        )
        .returning();
      if (!row) return undefined;
      // Jobs not started yet never will: fail them now so nothing stays queued
      // forever (boot recovery only re-enqueues runs of RUNNING suites).
      await tx
        .update(t.evalRuns)
        .set({ status: 'failed', error: CANCELLED_RUN_ERROR, ranAt: new Date() })
        .where(and(eq(t.evalRuns.suiteId, id), eq(t.evalRuns.status, 'queued')));
      return toSuite(row);
    });
  }

  async listRuns(suiteId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.suiteId, suiteId))
      .orderBy(asc(t.evalRuns.caseId), asc(t.evalRuns.arm), asc(t.evalRuns.repeatIdx));
    return rows.map(toRun);
  }

  async listCaseRuns(suiteId: string, caseId: string): Promise<CaseRunWithOutput[]> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.suiteId, suiteId), eq(t.evalRuns.caseId, caseId)))
      .orderBy(asc(t.evalRuns.arm), asc(t.evalRuns.repeatIdx));
    return rows.map((r) => ({ ...toRun(r), actualOutput: r.actualOutput }));
  }

  async caseSuites(
    workspaceId: string,
    caseId: string,
    limit: number,
  ): Promise<{ suite: EvalSuiteView; runs: EvalRunRecord[] }[]> {
    const suites = await this.suiteViews()
      .where(
        and(
          eq(t.evalSuites.workspaceId, workspaceId),
          ne(t.evalSuites.status, 'estimated'),
          sql`EXISTS (SELECT 1 FROM ${t.evalRuns} WHERE ${t.evalRuns.suiteId} = ${t.evalSuites.id} AND ${t.evalRuns.caseId} = ${caseId})`,
        ),
      )
      .orderBy(desc(t.evalSuites.createdAt), desc(t.evalSuites.id))
      .limit(limit);
    if (suites.length === 0) return [];
    const runs = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.caseId, caseId), inArray(t.evalRuns.suiteId, suites.map((r) => r.suite.id))));
    return suites.map((r) => ({
      suite: this.toView(r),
      runs: runs.filter((run) => run.suiteId === r.suite.id).map(toRun),
    }));
  }

  async latestCaseRuns(
    workspaceId: string,
    skillId: string,
  ): Promise<{ caseId: string; suite: EvalSuiteView; runs: EvalRunRecord[] }[]> {
    // A settled run is one that finished on its own: done, or failed for a real
    // reason. A run failed by cancelling its suite never executed, so it must
    // not push an earlier real result off the card.
    const settled = sql`(${t.evalRuns.status} = 'done' OR (${t.evalRuns.status} = 'failed' AND ${t.evalRuns.error} IS DISTINCT FROM ${CANCELLED_RUN_ERROR}))`;
    const pairs = await this.db
      .selectDistinctOn([t.evalRuns.caseId], { caseId: t.evalRuns.caseId, suiteId: t.evalRuns.suiteId })
      .from(t.evalRuns)
      .innerJoin(t.evalSuites, eq(t.evalSuites.id, t.evalRuns.suiteId))
      .where(
        and(
          eq(t.evalSuites.workspaceId, workspaceId),
          eq(t.evalSuites.skillId, skillId),
          inArray(t.evalSuites.status, ['done', 'failed', 'cancelled']),
          settled,
        ),
      )
      .orderBy(
        asc(t.evalRuns.caseId),
        desc(sql`COALESCE(${t.evalSuites.finishedAt}, ${t.evalSuites.createdAt})`),
        desc(t.evalSuites.id),
      );
    const latest = pairs.flatMap((p) => (p.caseId && p.suiteId ? [{ caseId: p.caseId, suiteId: p.suiteId }] : []));
    if (latest.length === 0) return [];
    const suiteIds = [...new Set(latest.map((l) => l.suiteId))];
    const [suites, runs] = await Promise.all([
      this.suiteViews().where(inArray(t.evalSuites.id, suiteIds)),
      this.db
        .select()
        .from(t.evalRuns)
        .where(and(inArray(t.evalRuns.suiteId, suiteIds), inArray(t.evalRuns.caseId, latest.map((l) => l.caseId)))),
    ]);
    const bySuite = new Map(suites.map((r) => [r.suite.id, this.toView(r)]));
    return latest.flatMap((l) => {
      const suite = bySuite.get(l.suiteId);
      if (!suite) return [];
      return [
        {
          caseId: l.caseId,
          suite,
          runs: runs.filter((r) => r.suiteId === l.suiteId && r.caseId === l.caseId).map(toRun),
        },
      ];
    });
  }

  async suiteCases(suiteId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.db
      .selectDistinct({ id: t.evalCases.id, name: t.evalCases.name, createdAt: t.evalCases.createdAt })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(eq(t.evalRuns.suiteId, suiteId))
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.id));
    return rows.map(({ id, name }) => ({ id, name }));
  }

  // ---- job lifecycle

  async claimRun(runId: string): Promise<ClaimedRun | undefined> {
    const [row] = await this.db
      .update(t.evalRuns)
      .set({ status: 'running' })
      .where(and(eq(t.evalRuns.id, runId), eq(t.evalRuns.status, 'queued'), isNotNull(t.evalRuns.suiteId)))
      .returning();
    if (!row || !row.suiteId) return undefined;
    const [[suite], [evalCase]] = await Promise.all([
      this.db.select().from(t.evalSuites).where(eq(t.evalSuites.id, row.suiteId)),
      this.db.select().from(t.evalCases).where(eq(t.evalCases.id, row.caseId)),
    ]);
    if (!suite) return undefined;
    return { run: toRun(row), suite: toSuite(suite), evalCase: evalCase ? toCase(evalCase) : undefined };
  }

  async runExists(runId: string): Promise<boolean> {
    const rows = await this.db.select({ id: t.evalRuns.id }).from(t.evalRuns).where(eq(t.evalRuns.id, runId));
    return rows.length > 0;
  }

  async finishRun(runId: string, result: EvalRunResult): Promise<boolean> {
    const values =
      result.status === 'done'
        ? {
            status: 'done' as const,
            pass: result.pass,
            matched: result.matched,
            expected: result.expected,
            unexpected: result.unexpected,
            recall: result.expected === 0 ? null : result.matched / result.expected,
            citationAccuracy: result.citationAccuracy,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            costUsd: result.costUsd,
            costSource: result.costSource,
            durationMs: result.durationMs,
            actualOutput: result.actualOutput,
            error: null,
            ranAt: new Date(),
          }
        : {
            status: 'failed' as const,
            error: result.error,
            durationMs: result.durationMs,
            costUsd: null,
            costSource: null,
            ranAt: new Date(),
          };
    const [first] = await this.db
      .update(t.evalRuns)
      .set(values)
      .where(and(eq(t.evalRuns.id, runId), eq(t.evalRuns.status, 'running')))
      .returning({ id: t.evalRuns.id });
    if (first) return true;
    // A late success after the run was already failed (e.g. by boot recovery)
    // still lands — the result is real — but the job was counted already.
    if (result.status === 'done') {
      await this.db
        .update(t.evalRuns)
        .set(values)
        .where(and(eq(t.evalRuns.id, runId), eq(t.evalRuns.status, 'failed')));
    }
    return false;
  }

  async countJob(suiteId: string): Promise<SuiteCounter | undefined> {
    const [row] = await this.db
      .update(t.evalSuites)
      .set({ doneJobs: sql`${t.evalSuites.doneJobs} + 1` })
      .where(eq(t.evalSuites.id, suiteId))
      .returning({
        doneJobs: t.evalSuites.doneJobs,
        totalJobs: t.evalSuites.totalJobs,
        status: t.evalSuites.status,
        mode: t.evalSuites.mode,
        repeats: t.evalSuites.repeats,
        partial: PARTIAL_SUITE,
      });
    return row;
  }

  async closeSuite(
    suiteId: string,
    patch: Parameters<EvalStore['closeSuite']>[1],
  ): Promise<boolean> {
    const rows = await this.db
      .update(t.evalSuites)
      .set({
        status: patch.status,
        results: patch.results,
        costUsd: patch.costUsd,
        costSource: patch.costSource,
        error: patch.error,
        finishedAt: new Date(),
      })
      .where(and(eq(t.evalSuites.id, suiteId), eq(t.evalSuites.status, 'running')))
      .returning({ id: t.evalSuites.id });
    return rows.length > 0;
  }

  // ---- boot recovery

  async failOrphanRuns(error: string): Promise<{ runId: string; suiteId: string }[]> {
    const rows = await this.db
      .update(t.evalRuns)
      .set({ status: 'failed', error, ranAt: new Date() })
      .where(and(eq(t.evalRuns.status, 'running'), isNotNull(t.evalRuns.suiteId)))
      .returning({ runId: t.evalRuns.id, suiteId: t.evalRuns.suiteId });
    return rows.flatMap((r) => (r.suiteId ? [{ runId: r.runId, suiteId: r.suiteId }] : []));
  }

  async reconcileRunningSuites(): Promise<(SuiteCounter & { suiteId: string })[]> {
    const count = (terminal: boolean) =>
      sql`(SELECT count(*)::int FROM ${t.evalRuns} WHERE ${t.evalRuns.suiteId} = ${t.evalSuites.id}${
        terminal ? sql` AND ${t.evalRuns.status} IN ('done', 'failed')` : sql``
      })`;
    return this.db
      .update(t.evalSuites)
      .set({ doneJobs: count(true), totalJobs: count(false) })
      .where(eq(t.evalSuites.status, 'running'))
      .returning({
        suiteId: t.evalSuites.id,
        doneJobs: t.evalSuites.doneJobs,
        totalJobs: t.evalSuites.totalJobs,
        status: t.evalSuites.status,
        mode: t.evalSuites.mode,
        repeats: t.evalSuites.repeats,
        partial: PARTIAL_SUITE,
      });
  }

  async queuedRunsOfRunningSuites(): Promise<QueuedRun[]> {
    const rows = await this.db
      .select({
        runId: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        suiteId: t.evalSuites.id,
        workspaceId: t.evalSuites.workspaceId,
        skillId: t.evalSuites.skillId,
        runConfig: t.evalSuites.runConfig,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalSuites, eq(t.evalSuites.id, t.evalRuns.suiteId))
      .where(and(eq(t.evalSuites.status, 'running'), eq(t.evalRuns.status, 'queued')))
      .orderBy(asc(t.evalRuns.caseId), asc(t.evalRuns.arm), asc(t.evalRuns.repeatIdx));
    return rows.map((r) => ({ ...r, runConfig: r.runConfig as EvalRunConfig }));
  }
}
