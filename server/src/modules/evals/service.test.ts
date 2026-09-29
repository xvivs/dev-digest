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
    return { doneJobs: s.doneJobs, totalJobs: s.totalJobs, status: s.status, mode: s.mode, repeats: s.repeats };
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
        return { suiteId: s.id, doneJobs: s.doneJobs, totalJobs: s.totalJobs, status: s.status, mode: s.mode, repeats: s.repeats };
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

  it('undefined for a skill outside the workspace', async () => {
    expect(await env.service.createSuite('other', 'sk', { carrierAgentId: 'ag', mode: 'quick' })).toBeUndefined();
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
