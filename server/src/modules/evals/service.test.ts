/**
 * EvalsService against in-memory ports (hermetic, no Docker, no LLM). The
 * DB-level guarantees (guarded UPDATEs, the atomic counter, the partial
 * unique index) are proved in test/evals.it.test.ts; this file pins the
 * service's own branching: gate order, claim/count bookkeeping,
 * cancellation, closing and boot recovery.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import { EvalsService } from './service.js';
import { EvalSuiteBusyError, isSuiteStale } from './domain.js';
import type {
  CarrierCandidate,
  EvalCarrier,
  EvalCase,
  EvalRunRecord,
  EvalSuiteRecord,
  EvalSuiteView,
  EvalTargetSkill,
} from './domain.js';
import type { EvalReviewInput, EvalReviewOutput, EvalStore, EvalsDeps } from './ports.js';
import { CANCELLED_RUN_ERROR, ORPHAN_RUN_ERROR } from './constants.js';

const WS = 'ws';
const EXPECTATION: EvalExpectation = {
  must_find: [{ file: 'a.ts', min_severity: 'WARNING', category: 'bug' }],
  must_not_find: [],
};

class InMemoryEvalStore implements EvalStore {
  skills = new Map<string, EvalTargetSkill>();
  carriers = new Map<string, EvalCarrier>();
  candidates: CarrierCandidate[] = [];
  cases = new Map<string, EvalCase>();
  suites = new Map<string, EvalSuiteRecord>();
  runs = new Map<string, EvalRunRecord>();
  inserts = 0;
  private seq = 0;
  private id = (p: string) => `${p}-${++this.seq}`;

  async findSkill(ws: string, id: string) {
    const s = this.skills.get(id);
    return s && s.workspaceId === ws ? s : undefined;
  }
  async findCarrier(_ws: string, id: string) {
    return this.carriers.get(id);
  }
  async carrierCandidates() {
    return this.candidates;
  }
  async listCases(ws: string, skillId: string) {
    return [...this.cases.values()].filter((c) => c.workspaceId === ws && c.skillId === skillId);
  }
  async findCase(ws: string, id: string) {
    const c = this.cases.get(id);
    return c && c.workspaceId === ws ? c : undefined;
  }
  async insertCase(): Promise<EvalCase> {
    throw new Error('not used');
  }
  async updateCase() {
    return undefined;
  }
  async deleteCase() {
    return false;
  }
  private view(s: EvalSuiteRecord): EvalSuiteView {
    const skill = this.skills.get(s.skillId);
    const carrier = this.carriers.get(s.carrierAgentId);
    const { runConfig: _c, carrierAgentName: _n, ...rest } = s;
    return {
      ...rest,
      carrierName: carrier?.name ?? null,
      stale: isSuiteStale(s, { promptSha256: skill?.promptSha256 ?? null, carrierVersion: carrier?.version ?? null }),
    };
  }
  async insertSuite(input: Parameters<EvalStore['insertSuite']>[0], caseIds: string[]) {
    this.inserts++;
    const suite: EvalSuiteRecord = {
      ...input,
      id: this.id('suite'),
      status: 'estimated',
      doneJobs: 0,
      costUsd: null,
      costSource: null,
      results: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    };
    this.suites.set(suite.id, suite);
    for (const caseId of caseIds) {
      for (const arm of ['with', 'without'] as const) {
        for (let repeatIdx = 0; repeatIdx < input.repeats; repeatIdx++) {
          const id = this.id('run');
          this.runs.set(id, {
            id,
            suiteId: suite.id,
            caseId,
            arm,
            repeatIdx,
            status: 'queued',
            pass: null,
            matched: null,
            expected: null,
            unexpected: null,
            citationAccuracy: null,
            tokensIn: null,
            tokensOut: null,
            costUsd: null,
            costSource: null,
            durationMs: null,
            error: null,
            ranAt: null,
          });
        }
      }
    }
    return this.view(suite);
  }
  async listSuites() {
    return [...this.suites.values()].map((s) => this.view(s));
  }
  async findSuite(ws: string, id: string) {
    const s = this.suites.get(id);
    return s && s.workspaceId === ws ? this.view(s) : undefined;
  }
  async startSuite(ws: string, id: string) {
    if ([...this.suites.values()].some((s) => s.workspaceId === ws && s.status === 'running')) {
      throw new EvalSuiteBusyError();
    }
    const s = this.suites.get(id);
    if (!s || s.status !== 'estimated') return undefined;
    s.status = 'running';
    s.totalJobs = [...this.runs.values()].filter((r) => r.suiteId === id).length;
    return s;
  }
  async cancelSuite(_ws: string, id: string) {
    const s = this.suites.get(id);
    if (!s || !['estimated', 'running'].includes(s.status)) return undefined;
    s.status = 'cancelled';
    for (const r of this.runs.values()) {
      if (r.suiteId === id && r.status === 'queued') Object.assign(r, { status: 'failed', error: CANCELLED_RUN_ERROR });
    }
    return s;
  }
  async listRuns(suiteId: string) {
    return [...this.runs.values()].filter((r) => r.suiteId === suiteId);
  }
  async listCaseRuns(suiteId: string, caseId: string) {
    return [...this.runs.values()]
      .filter((r) => r.suiteId === suiteId && r.caseId === caseId)
      .map((r) => ({ ...r, actualOutput: (r as { actualOutput?: unknown }).actualOutput ?? null }));
  }
  async caseSuites(ws: string, caseId: string, limit: number) {
    return [...this.suites.values()]
      .filter((s) => s.workspaceId === ws && s.status !== 'estimated')
      .filter((s) => [...this.runs.values()].some((r) => r.suiteId === s.id && r.caseId === caseId))
      .reverse()
      .slice(0, limit)
      .map((s) => ({
        suite: this.view(s),
        runs: [...this.runs.values()].filter((r) => r.suiteId === s.id && r.caseId === caseId),
      }));
  }
  async suiteCases(suiteId: string) {
    const ids = new Set((await this.listRuns(suiteId)).map((r) => r.caseId));
    return [...ids].map((id) => ({ id, name: this.cases.get(id)?.name ?? id }));
  }
  async claimRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'queued') return undefined;
    run.status = 'running';
    return { run, suite: this.suites.get(run.suiteId)!, evalCase: this.cases.get(run.caseId) };
  }
  async runExists(runId: string) {
    return this.runs.has(runId);
  }
  async finishRun(runId: string, result: Parameters<EvalStore['finishRun']>[1]) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') return false;
    Object.assign(run, result.status === 'done' ? { ...result, error: null } : { ...result, costUsd: null, costSource: null });
    return true;
  }
  async countJob(suiteId: string) {
    const s = this.suites.get(suiteId);
    if (!s) return undefined;
    s.doneJobs++;
    return { doneJobs: s.doneJobs, totalJobs: s.totalJobs, status: s.status, mode: s.mode, repeats: s.repeats, partial: s.caseIds !== null };
  }
  async closeSuite(suiteId: string, patch: Parameters<EvalStore['closeSuite']>[1]) {
    const s = this.suites.get(suiteId);
    if (!s || s.status !== 'running') return false;
    Object.assign(s, patch, { finishedAt: new Date() });
    return true;
  }
  async failOrphanRuns(error: string) {
    const out: { runId: string; suiteId: string }[] = [];
    for (const r of this.runs.values()) {
      if (r.status === 'running') {
        Object.assign(r, { status: 'failed', error });
        out.push({ runId: r.id, suiteId: r.suiteId });
      }
    }
    return out;
  }
  async reconcileRunningSuites() {
    return [...this.suites.values()]
      .filter((s) => s.status === 'running')
      .map((s) => {
        const runs = [...this.runs.values()].filter((r) => r.suiteId === s.id);
        s.doneJobs = runs.filter((r) => r.status === 'done' || r.status === 'failed').length;
        s.totalJobs = runs.length;
        return { suiteId: s.id, doneJobs: s.doneJobs, totalJobs: s.totalJobs, status: s.status, mode: s.mode, repeats: s.repeats, partial: s.caseIds !== null };
      });
  }
  async queuedRunsOfRunningSuites() {
    return [...this.runs.values()]
      .filter((r) => r.status === 'queued' && this.suites.get(r.suiteId)?.status === 'running')
      .map((r) => {
        const s = this.suites.get(r.suiteId)!;
        return { runId: r.id, caseId: r.caseId, suiteId: s.id, workspaceId: s.workspaceId, skillId: s.skillId, runConfig: s.runConfig };
      });
  }
}

function setup() {
  const store = new InMemoryEvalStore();
  store.skills.set('sk', {
    id: 'sk',
    workspaceId: WS,
    name: 'target',
    body: 'TARGET',
    version: 2,
    source: 'manual',
    vettedBodyHash: null,
    bodySha256: 'body-hash',
    promptSha256: 'prompt-hash',
  });
  store.carriers.set('ag', {
    id: 'ag',
    name: 'alpha',
    version: 1,
    provider: 'openai',
    model: 'm',
    systemPrompt: 'Review.',
    strategy: 'single-pass',
  });
  // The default fixture carrier links the skill with an enabled link.
  store.candidates = [{ agentId: 'ag', agentName: 'alpha', runs: 0 }];
  for (const id of ['c1', 'c2']) {
    store.cases.set(id, {
      id,
      workspaceId: WS,
      ownerKind: 'skill',
      ownerId: 'sk',
      skillId: 'sk',
      name: id,
      inputDiff: 'diff --git a/a.ts b/a.ts',
      inputFiles: ['a.ts'],
      inputMeta: { kind: 'paste' },
      expectedOutput: EXPECTATION,
      expectation: EXPECTATION,
      inputSource: { kind: 'paste' },
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const reviews: EvalReviewInput[] = [];
  const enqueued: string[] = [];
  let reviewImpl = async (input: EvalReviewInput): Promise<EvalReviewOutput> => ({
    findings: input.skills.some((s) => s.id === 'sk')
      ? [
          {
            id: 'f',
            severity: 'WARNING',
            category: 'bug',
            title: 't',
            file: 'a.ts',
            start_line: 1,
            end_line: 1,
            rationale: 'r',
            confidence: 1,
          },
        ]
      : [],
    grounding: '1/1 passed',
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    costSource: 'provider',
    raw: '',
  });
  const deps: EvalsDeps = {
    store,
    prs: { getPull: async () => undefined, getPrFiles: async () => [] },
    skills: { effectiveSkills: async () => [{ id: 'other', name: 'other', body: 'OTHER' }] },
    diffs: { files: () => [{ path: 'a.ts', additions: 1, deletions: 0 }] },
    reviewer: {
      review: async (input) => {
        reviews.push(input);
        return reviewImpl(input);
      },
    },
    queue: {
      enqueue: async (_ws, payload) => {
        enqueued.push(payload.runId);
      },
    },
    price: (_m, tin, tout) => (tin + tout) / 1_000_000,
    maxBudgetUsd: 5,
  };
  const service = new EvalsService(deps);
  const drain = async () => {
    while (enqueued.length > 0) await service.runJob({ suiteId: [...store.suites.keys()].at(-1)!, runId: enqueued.shift()! });
  };
  return {
    store,
    deps,
    service,
    reviews,
    enqueued,
    drain,
    setReview: (fn: typeof reviewImpl) => {
      reviewImpl = fn;
    },
  };
}

describe('EvalsService.createSuite', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it('freezes both arms: with = carrier skills + target, run config from the carrier', async () => {
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' });
    expect(suite).toMatchObject({ status: 'estimated', totalJobs: 4, repeats: 1, model: 'm', promptSha256: 'prompt-hash' });
    const record = env.store.suites.get(suite!.id)!;
    expect(record.runConfig.withSkills.map((s) => s.id)).toEqual(['other', 'sk']);
    expect(suite!.estimateUsd).toBeGreaterThan(0);
  });

  it('trust gate runs before any carrier or price lookup', async () => {
    env.store.skills.get('sk')!.source = 'imported';
    env.deps.price = () => {
      throw new Error('price must not be read');
    };
    await expect(env.service.createSuite(WS, 'sk', { carrierAgentId: 'nope', mode: 'quick' })).rejects.toMatchObject({
      code: 'eval_skill_not_vetted',
    });
    env.store.skills.get('sk')!.vettedBodyHash = 'body-hash';
    env.deps.price = () => 0.001;
    await expect(env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' })).resolves.toBeDefined();
  });

  it('an unknown price refuses the suite and stores nothing', async () => {
    env.deps.price = () => null;
    await expect(env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'full' })).rejects.toMatchObject({
      code: 'eval_price_unknown',
    });
    expect(env.store.inserts).toBe(0);
  });

  it('defaults the carrier to the linked agent with the most runs', async () => {
    env.store.candidates = [
      { agentId: 'zz', agentName: 'zeta', runs: 1 },
      { agentId: 'ag', agentName: 'alpha', runs: 9 },
    ];
    const suite = await env.service.createSuite(WS, 'sk', { mode: 'quick' });
    expect(suite?.carrierAgentId).toBe('ag');
  });

  it('an explicit carrier that is not an eligible candidate is 422 eval_carrier_not_linked, before any estimate', async () => {
    env.store.candidates = [];
    await expect(env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' })).rejects.toMatchObject({
      code: 'eval_carrier_not_linked',
      statusCode: 422,
    });
    expect(env.store.inserts).toBe(0);
  });

  it('no candidates and no explicit carrier is eval_no_carrier; an unknown carrier stays 404', async () => {
    env.store.candidates = [];
    await expect(env.service.createSuite(WS, 'sk', { mode: 'quick' })).rejects.toMatchObject({ code: 'eval_no_carrier' });
    await expect(env.service.createSuite(WS, 'sk', { carrierAgentId: 'nope', mode: 'quick' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('listCarriers ranks candidates and flags only the first as default', async () => {
    env.store.candidates = [
      { agentId: 'zz', agentName: 'zeta', runs: 1 },
      { agentId: 'ag', agentName: 'alpha', runs: 9 },
    ];
    expect(await env.service.listCarriers(WS, 'sk')).toEqual([
      { agentId: 'ag', agentName: 'alpha', runs: 9, isDefault: true },
      { agentId: 'zz', agentName: 'zeta', runs: 1, isDefault: false },
    ]);
    expect(await env.service.listCarriers('other', 'sk')).toBeUndefined();
  });

  it('undefined for a skill outside the workspace', async () => {
    expect(await env.service.createSuite('other', 'sk', { carrierAgentId: 'ag', mode: 'quick' })).toBeUndefined();
  });
});

describe('EvalsService.createSuite with case_ids (per-case run)', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it('runs only the chosen cases: total_jobs, runs and estimate reflect the subset; the subset is stored', async () => {
    const full = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'full' });
    const one = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'full', caseIds: ['c2'] });
    expect(full).toMatchObject({ totalJobs: 12, caseIds: null });
    expect(one).toMatchObject({ totalJobs: 6, caseIds: ['c2'] });
    expect(one!.estimateUsd).toBeCloseTo(full!.estimateUsd / 2, 10);
    const runs = await env.store.listRuns(one!.id);
    expect(new Set(runs.map((r) => r.caseId))).toEqual(new Set(['c2']));
  });

  it('a case id that is not a runnable case of the skill is 422 eval_case_not_found and stores nothing', async () => {
    await expect(
      env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick', caseIds: ['c1', 'ghost'] }),
    ).rejects.toMatchObject({ code: 'eval_case_not_found', statusCode: 422, details: { case_ids: ['ghost'] } });
    // a case of another skill and a legacy (unparseable) case are not runnable either
    env.store.cases.set('foreign', { ...env.store.cases.get('c1')!, id: 'foreign', skillId: 'other-skill' });
    env.store.cases.set('legacy', { ...env.store.cases.get('c1')!, id: 'legacy', expectation: null });
    await expect(
      env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick', caseIds: ['foreign', 'legacy'] }),
    ).rejects.toMatchObject({ code: 'eval_case_not_found' });
    expect(env.store.inserts).toBe(0);
  });

  it('duplicate ids collapse to one case; the gates (trust, budget) still apply', async () => {
    const dup = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick', caseIds: ['c1', 'c1'] });
    expect(dup).toMatchObject({ totalJobs: 2, caseIds: ['c1'] });
    env.deps.maxBudgetUsd = 0;
    await expect(
      env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick', caseIds: ['c1'] }),
    ).rejects.toMatchObject({ code: 'eval_budget_exceeded' });
  });

  it('a partial suite closes with an indicative verdict and reads back as partial', async () => {
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick', caseIds: ['c1'] });
    await env.service.startSuite(WS, suite!.id);
    await env.drain();
    const detail = await env.service.getSuiteDetail(WS, suite!.id);
    expect(detail!.suite).toMatchObject({ status: 'done', caseIds: ['c1'] });
    expect(detail!.suite.results?.verdict).toBe('indicative');
    expect(detail!.cases).toHaveLength(1);
  });
});

describe('EvalsService.getCaseDetail', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  async function runQuick(caseIds?: string[]) {
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick', ...(caseIds ? { caseIds } : {}) });
    await env.service.startSuite(WS, suite!.id);
    await env.drain();
    return suite!.id;
  }

  it('undefined for an unknown case or a case of another workspace', async () => {
    expect(await env.service.getCaseDetail(WS, 'nope', {})).toBeUndefined();
    expect(await env.service.getCaseDetail('other', 'c1', {})).toBeUndefined();
  });

  it('a case that never ran: suite null, empty arms, no outcome, empty history', async () => {
    const d = await env.service.getCaseDetail(WS, 'c1', {});
    expect(d).toMatchObject({ suite: null, outcome: null, history: [], expectationChanged: false });
    expect(d!.arms.with.runs).toEqual([]);
    expect(d!.arms.without.runs).toEqual([]);
  });

  it('defaults to the latest started suite containing the case, with per-arm runs and history', async () => {
    const first = await runQuick();
    const second = await runQuick(['c1']);
    const d = await env.service.getCaseDetail(WS, 'c1', {});
    expect(d!.suite?.id).toBe(second);
    expect(d!.outcome).toBe('caught');
    expect(d!.arms.with.runs[0]).toMatchObject({ status: 'done', pass: true, matched_must_find: [0], missed_must_find: [] });
    expect(d!.arms.without.runs[0]).toMatchObject({ pass: false, matched_must_find: [], missed_must_find: [0] });
    expect(d!.history.map((h) => h.suite.id)).toEqual([second, first]);
    expect(d!.history.map((h) => h.outcome)).toEqual(['caught', 'caught']);
    // a case only ever run in the first (full) suite must not see the second
    const c2 = await env.service.getCaseDetail(WS, 'c2', {});
    expect(c2!.suite?.id).toBe(first);
  });

  it('an explicit suite id picks that suite; a suite that does not contain the case is refused', async () => {
    const first = await runQuick();
    const second = await runQuick(['c1']);
    const d = await env.service.getCaseDetail(WS, 'c1', { suiteId: first });
    expect(d!.suite?.id).toBe(first);
    await expect(env.service.getCaseDetail(WS, 'c2', { suiteId: second })).rejects.toMatchObject({ statusCode: 404 });
    await expect(env.service.getCaseDetail(WS, 'c1', { suiteId: 'ghost' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('flags a case edited after the suite started', async () => {
    await runQuick();
    env.store.cases.get('c1')!.updatedAt = new Date(Date.now() + 60_000);
    expect((await env.service.getCaseDetail(WS, 'c1', {}))!.expectationChanged).toBe(true);
  });
});

describe('EvalsService.createCase', () => {
  it('a PR-built diff over the paste cap is refused (422), like an oversized paste', async () => {
    const env = setup();
    env.deps.prs = {
      getPull: async () => ({ id: 'pr', number: 1, headSha: 'h' }),
      getPrFiles: async () => [{ path: 'a.ts', patch: `@@ -1 +1 @@\n+${'x'.repeat(200_001)}` }],
    };
    await expect(
      env.service.createCase(WS, 'sk', {
        name: 'big',
        source: { kind: 'pr', pr_id: '00000000-0000-4000-8000-000000000000', files: ['a.ts'] },
        expectation: EXPECTATION,
      }),
    ).rejects.toMatchObject({ code: 'validation_error', statusCode: 422 });
  });
});

describe('EvalsService runner', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  async function startedQuick() {
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' });
    await env.service.startSuite(WS, suite!.id);
    return suite!.id;
  }

  it('runs every job, the last count closes the suite with results and cost', async () => {
    const id = await startedQuick();
    expect(env.enqueued).toHaveLength(4);
    await env.drain();
    const s = env.store.suites.get(id)!;
    expect(s.status).toBe('done');
    expect(s.doneJobs).toBe(4);
    expect(s.results).toMatchObject({ caught: 2, total: 2, verdict: 'indicative' });
    expect(s.costUsd).toBeCloseTo(0.04);
    expect(s.costSource).toBe('provider');
    // `without` never sees the target; `with` does, at the pinned body.
    const withArm = env.reviews.filter((r) => r.skills.some((s) => s.id === 'sk'));
    expect(withArm).toHaveLength(2);
    expect(withArm[0]!.skills.find((s) => s.id === 'sk')!.body).toBe('TARGET');
  });

  it('getSuiteDetail derives results live: a done suite stored before `errored` existed still reports it', async () => {
    const id = await startedQuick();
    await env.drain();
    // Rewind to the pre-fix shape: case c1's runs failed, stored results predate `errored`.
    const c1 = [...env.store.runs.values()].filter((r) => r.suiteId === id && r.caseId === 'c1');
    for (const r of c1) Object.assign(r, { status: 'failed', pass: null, error: 'boom' });
    const stored = env.store.suites.get(id)!;
    const staleVerdict = stored.results!.verdict;
    stored.results = { ...stored.results!, passing: 0, total: 1, errored: 0 };

    const detail = await env.service.getSuiteDetail(WS, id);
    expect(detail!.suite.results).toMatchObject({ errored: 1, passing: 1, total: 1, verdict: staleVerdict });
    expect(detail!.cases.find((c) => c.case_id === 'c1')!.outcome).toBe('error');
    // Read path only: the stored column is untouched.
    expect(stored.results!.errored).toBe(0);
  });

  it('getSuiteDetail keeps stored results null for a non-done suite', async () => {
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' });
    const detail = await env.service.getSuiteDetail(WS, suite!.id);
    expect(detail!.suite.results).toBeNull();
  });

  it('a duplicate job for a claimed run calls no model and counts nothing', async () => {
    const id = await startedQuick();
    const runId = env.enqueued[0]!;
    await env.service.runJob({ suiteId: id, runId });
    await env.service.runJob({ suiteId: id, runId });
    expect(env.reviews).toHaveLength(1);
    expect(env.store.suites.get(id)!.doneJobs).toBe(1);
  });

  it('a run deleted with its case still counts, so the suite can close', async () => {
    const id = await startedQuick();
    const runId = env.enqueued[0]!;
    env.store.runs.delete(runId);
    await env.service.runJob({ suiteId: id, runId });
    expect(env.reviews).toHaveLength(0);
    expect(env.store.suites.get(id)!.doneJobs).toBe(1);
  });

  it('a job timeout fails the hung run and counts it once, so the suite still closes', async () => {
    const id = await startedQuick();
    const [hungId, ...rest] = env.enqueued.splice(0);
    let release!: () => void;
    env.setReview(
      (input) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ findings: [], grounding: '', tokensIn: 1, tokensOut: 1, costUsd: 0, costSource: 'provider', raw: '' });
          void input;
        }),
    );
    const hung = env.service.runJob({ suiteId: id, runId: hungId! });
    await new Promise((r) => setTimeout(r, 0)); // the run is claimed, the model call pending

    await env.service.timeOutJob({ suiteId: id, runId: hungId! }, 360_000);
    const run = env.store.runs.get(hungId!)!;
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/timed out after 360s/i);
    expect(env.store.suites.get(id)!.doneJobs).toBe(1);

    // A second timeout signal, and the late model answer, count nothing more.
    await env.service.timeOutJob({ suiteId: id, runId: hungId! }, 360_000);
    release();
    await hung;
    expect(env.store.suites.get(id)!.doneJobs).toBe(1);

    env.setReview(async () => ({ findings: [], grounding: '', tokensIn: 1, tokensOut: 1, costUsd: 0, costSource: 'provider', raw: '' }));
    env.enqueued.push(...rest);
    await env.drain();
    expect(env.store.suites.get(id)!.status).toBe('done');
  });

  it('a timeout signal for a run that already finished changes nothing', async () => {
    const id = await startedQuick();
    const runId = env.enqueued[0]!;
    await env.service.runJob({ suiteId: id, runId });
    await env.service.timeOutJob({ suiteId: id, runId }, 360_000);
    expect(env.store.runs.get(runId)!.status).toBe('done');
    expect(env.store.suites.get(id)!.doneJobs).toBe(1);
  });

  it('a failing model call fails the run; all runs failed → the suite fails, no results', async () => {
    env.setReview(async () => {
      throw new Error('provider 500');
    });
    const id = await startedQuick();
    await env.drain();
    const s = env.store.suites.get(id)!;
    expect(s.status).toBe('failed');
    expect(s.results).toBeNull();
    expect(s.error).toContain('provider 500');
    expect([...env.store.runs.values()].every((r) => r.status === 'failed')).toBe(true);
  });

  it('cancel mid-run: the in-flight job aborts at the next chunk; queued jobs never call the model', async () => {
    const id = await startedQuick();
    env.setReview(async (input) => {
      await env.service.cancelSuite(WS, id);
      input.checkCancelled(); // the next chunk boundary
      throw new Error('unreachable');
    });
    await env.drain();
    expect(env.reviews).toHaveLength(1);
    const runs = [...env.store.runs.values()];
    expect(runs.every((r) => r.status === 'failed' && r.error === CANCELLED_RUN_ERROR)).toBe(true);
    expect(env.store.suites.get(id)!.status).toBe('cancelled');
  });

  it('start is refused when stale, and a replay is a no-op', async () => {
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' });
    env.store.carriers.get('ag')!.version = 2;
    await expect(env.service.startSuite(WS, suite!.id)).rejects.toMatchObject({ code: 'eval_suite_stale' });
    env.store.carriers.get('ag')!.version = 1;
    await env.service.startSuite(WS, suite!.id);
    const queuedOnce = env.enqueued.length;
    await env.service.startSuite(WS, suite!.id);
    expect(env.enqueued).toHaveLength(queuedOnce);
  });
});

describe('EvalsService.recoverOnBoot', () => {
  it('fails orphans, heals the counter, closes a complete suite and re-enqueues queued runs', async () => {
    const env = setup();
    const suite = await env.service.createSuite(WS, 'sk', { carrierAgentId: 'ag', mode: 'quick' });
    await env.service.startSuite(WS, suite!.id);
    env.enqueued.length = 0; // the "old process" died with these in its queue

    const runs = [...env.store.runs.values()];
    runs[0]!.status = 'running'; // in flight when it died
    Object.assign(runs[1]!, { status: 'done', pass: true, unexpected: 0, costUsd: 0.01, costSource: 'provider' }); // finished, never counted

    const out = await env.service.recoverOnBoot();
    expect(out).toEqual({ orphaned: 1, requeued: 2, closed: 0 });
    expect(runs[0]).toMatchObject({ status: 'failed', error: ORPHAN_RUN_ERROR });
    expect(env.store.suites.get(suite!.id)!.doneJobs).toBe(2);

    await env.drain();
    const s = env.store.suites.get(suite!.id)!;
    expect(s.status).toBe('done');
    expect(s.doneJobs).toBe(4);
  });
});
