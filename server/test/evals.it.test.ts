/**
 * Plan Phase 3 end to end over HTTP (Testcontainers pg + a scripted fake LLM,
 * no real API call). Covers the Verification list: idempotent retry, atomic
 * close at concurrency 2, start replay no-op, budget refusal, trust gate 409,
 * Quick never yields a verdict, stale key, boot recovery, and the verdict
 * reaching GET /skills and the Stats impact block.
 *
 * The fake LLM "sees" the target skill when its marker is in the prompt and
 * then reports the planted secret; without it the review is clean. So every
 * defect case is `caught` by construction.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { EVAL_RUN_JOB_KIND, ORPHAN_RUN_ERROR } from '../src/modules/evals/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const TARGET_MARKER = 'EVAL-TARGET-MARKER';

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const EXPECTATION = {
  must_find: [
    {
      file: 'src/config.ts',
      line_range: { start: 11, end: 11 },
      min_severity: 'WARNING',
      category: 'security',
      contains: 'stripe',
    },
  ],
};

class ScriptedLLM implements LLMProvider {
  readonly id = 'openai' as const;
  calls = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** When set, the next call holds until a second call is in flight (≤ 5 s),
   *  so a runner with concurrency ≥ 2 provably overlaps two jobs. */
  awaitOverlap = false;
  constructor(private delayMs = 0) {}
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('complete() is not used by reviews');
  }
  async embed(texts: string[]) {
    return texts.map(() => [] as number[]);
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.awaitOverlap) {
        this.awaitOverlap = false;
        const until = Date.now() + 5_000;
        while (this.inFlight < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
      }
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      const prompt = req.messages.map((m) => m.content).join('\n');
      const review: Review = {
        verdict: 'comment',
        summary: 'scripted',
        score: 50,
        findings: prompt.includes(TARGET_MARKER)
          ? [
              {
                id: 'f1',
                severity: 'CRITICAL',
                category: 'security',
                title: 'Hardcoded Stripe live key',
                file: 'src/config.ts',
                start_line: 11,
                end_line: 11,
                rationale: 'A live secret is committed.',
                confidence: 0.9,
              },
            ]
          : [],
      };
      return {
        data: req.schema.parse(review),
        model: req.model,
        tokensIn: 1000,
        tokensOut: 200,
        costUsd: 0.002,
        costSource: 'estimated',
        raw: JSON.stringify(review),
        attempts: 1,
      };
    } finally {
      this.inFlight--;
    }
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

d('evals: cases, suites and the ablation runner (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: FastifyInstance;
  const llm = new ScriptedLLM(15);
  const apps: FastifyInstance[] = [];

  const config = (env: Record<string, string> = {}) =>
    loadConfig({ ...process.env, NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);

  async function makeApp(provider: LLMProvider = llm, env: Record<string, string> = {}) {
    const a = await buildApp({
      config: config(env),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: { openai: provider } },
    });
    apps.push(a);
    return a;
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await makeApp();
  });
  afterAll(async () => {
    for (const a of apps) await a.close();
    await pg?.stop();
  });

  const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  async function createSkill(over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `eval-${uniq()}`, type: 'security', body: `Flag live secrets. ${TARGET_MARKER}`, ...over },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; version: number; name: string };
  }

  async function createAgent(model = 'gpt-4.1') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `carrier-${uniq()}`, provider: 'openai', model, system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBeLessThan(300);
    return res.json() as { id: string; name: string };
  }

  async function addCases(skillId: string, n: number, expectation: unknown = EXPECTATION) {
    for (let i = 0; i < n; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/skills/${skillId}/eval-cases`,
        payload: { name: `case ${i}`, source: { kind: 'paste', diff: DIFF }, expectation },
      });
      expect(res.statusCode).toBe(201);
    }
  }

  async function createSuite(a: FastifyInstance, skillId: string, carrierId: string | undefined, mode: 'quick' | 'full') {
    return a.inject({
      method: 'POST',
      url: `/skills/${skillId}/eval-suites`,
      payload: { mode, ...(carrierId ? { carrier_agent_id: carrierId } : {}) },
    });
  }

  async function waitSuite(a: FastifyInstance, id: string, timeoutMs = 30_000) {
    const start = Date.now();
    for (;;) {
      const res = await a.inject({ method: 'GET', url: `/eval-suites/${id}` });
      const body = res.json();
      if (TERMINAL.has(body.status)) return body;
      if (Date.now() - start > timeoutMs) throw new Error(`suite ${id} still ${body.status}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  const evalJobCount = async () =>
    Number(
      (await pg.handle.db.select({ n: count() }).from(t.jobs).where(eq(t.jobs.kind, EVAL_RUN_JOB_KIND)))[0]!.n,
    );

  // ---------------------------------------------------------------- cases

  describe('cases', () => {
    it('paste: snapshots the diff and echoes provenance + parsed expectation', async () => {
      const skill = await createSkill();
      const res = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/eval-cases`,
        payload: { name: 'secret', source: { kind: 'paste', diff: DIFF }, expectation: EXPECTATION, notes: 'n' },
      });
      expect(res.statusCode).toBe(201);
      const c = res.json();
      expect(c.skill_id).toBe(skill.id);
      expect(c.owner_kind).toBe('skill');
      expect(c.input_diff).toBe(DIFF);
      expect(c.input_source).toEqual({ kind: 'paste' });
      expect(c.expectation.must_find).toHaveLength(1);
      expect(c.expectation.must_not_find).toEqual([]);

      const list = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` })).json();
      expect(list.map((x: { id: string }) => x.id)).toEqual([c.id]);
    });

    it('from PR: builds the diff from the chosen files only; later PR changes do not touch the case', async () => {
      const skill = await createSkill();
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: `r-${uniq()}`, fullName: `acme/r-${uniq()}` })
        .returning();
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: repo!.id,
          number: 42,
          title: 'PR',
          author: 'a',
          branch: 'b',
          base: 'main',
          headSha: 'abc123',
        })
        .returning();
      await pg.handle.db.insert(t.prFiles).values([
        { prId: pr!.id, path: 'src/config.ts', patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,' },
        { prId: pr!.id, path: 'README.md', patch: '@@ -1 +1 @@\n-a\n+b' },
        { prId: pr!.id, path: 'logo.png', patch: null },
      ]);

      const ok = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/eval-cases`,
        payload: { name: 'from pr', source: { kind: 'pr', pr_id: pr!.id, files: ['src/config.ts'] }, expectation: EXPECTATION },
      });
      expect(ok.statusCode).toBe(201);
      const c = ok.json();
      expect(c.input_diff).toContain('diff --git a/src/config.ts b/src/config.ts');
      expect(c.input_diff).not.toContain('README.md');
      expect(c.input_source).toEqual({
        kind: 'pr',
        pr_id: pr!.id,
        pr_number: 42,
        head_sha: 'abc123',
        files: ['src/config.ts'],
      });

      await pg.handle.db
        .update(t.prFiles)
        .set({ patch: '@@ -1 +1 @@\n-x\n+y' })
        .where(and(eq(t.prFiles.prId, pr!.id), eq(t.prFiles.path, 'src/config.ts')));
      const again = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` })).json();
      expect(again[0].input_diff).toBe(c.input_diff);

      const notInPr = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/eval-cases`,
        payload: { name: 'x', source: { kind: 'pr', pr_id: pr!.id, files: ['nope.ts'] }, expectation: EXPECTATION },
      });
      expect(notInPr.statusCode).toBe(422);
      expect(notInPr.json().error.code).toBe('eval_case_file_not_in_pr');

      const binary = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/eval-cases`,
        payload: { name: 'x', source: { kind: 'pr', pr_id: pr!.id, files: ['logo.png'] }, expectation: EXPECTATION },
      });
      expect(binary.statusCode).toBe(422);
      expect(binary.json().error.details.reason).toBe('no_patch');

      const unknownPr = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/eval-cases`,
        payload: { name: 'x', source: { kind: 'pr', pr_id: crypto.randomUUID(), files: ['a.ts'] }, expectation: EXPECTATION },
      });
      expect(unknownPr.statusCode).toBe(404);
    });

    it('rejects an expectation outside the diff, extra keys (strict) and a both-sided case', async () => {
      const skill = await createSkill();
      const post = (expectation: unknown) =>
        app.inject({
          method: 'POST',
          url: `/skills/${skill.id}/eval-cases`,
          payload: { name: 'x', source: { kind: 'paste', diff: DIFF }, expectation },
        });
      const outside = await post({ must_find: [{ ...EXPECTATION.must_find[0], file: 'src/other.ts' }] });
      expect(outside.statusCode).toBe(422);
      expect(outside.json().error.code).toBe('validation_error');
      expect((await post({ must_find: [{ ...EXPECTATION.must_find[0], regex: '.*' }] })).statusCode).toBe(422);
      expect(
        (await post({ must_find: EXPECTATION.must_find, must_not_find: [{ file: 'src/config.ts' }] })).statusCode,
      ).toBe(422);
    });

    it('PUT updates, DELETE removes, foreign ids are 404', async () => {
      const skill = await createSkill();
      await addCases(skill.id, 1);
      const [c] = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` })).json();
      const put = await app.inject({ method: 'PUT', url: `/eval-cases/${c.id}`, payload: { name: 'renamed' } });
      expect(put.statusCode).toBe(200);
      expect(put.json().name).toBe('renamed');
      expect(put.json().input_diff).toBe(DIFF);
      expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${c.id}` })).json()).toEqual({ ok: true });
      expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${c.id}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/skills/${crypto.randomUUID()}/eval-cases` })).statusCode).toBe(404);
    });

    it('a legacy row with an unparseable expected_output reads as expectation: null and is skipped by suites', async () => {
      const skill = await createSkill();
      await pg.handle.db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'skill',
        ownerId: skill.id,
        skillId: skill.id,
        name: 'legacy',
        inputDiff: DIFF,
        expectedOutput: { precision: 0.5, recall: 1 },
      });
      const [legacy] = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` })).json();
      expect(legacy.expectation).toBeNull();
      expect(legacy.expected_output).toEqual({ precision: 0.5, recall: 1 });

      const agent = await createAgent();
      const res = await createSuite(app, skill.id, agent.id, 'quick');
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('eval_no_cases');
    });
  });

  // ---------------------------------------------------------------- estimate guards

  describe('suite estimate', () => {
    it('creates an estimated suite: total_jobs = cases × 2 × repeats, model = carrier model, nothing runs', async () => {
      const skill = await createSkill();
      const agent = await createAgent();
      await addCases(skill.id, 2);
      const callsBefore = llm.calls;
      const res = await createSuite(app, skill.id, agent.id, 'full');
      expect(res.statusCode).toBe(201);
      const s = res.json();
      expect(s).toMatchObject({
        status: 'estimated',
        mode: 'full',
        repeats: 3,
        total_jobs: 12,
        done_jobs: 0,
        model: 'gpt-4.1',
        carrier_agent_id: agent.id,
        carrier_name: agent.name,
        skill_version: skill.version,
        stale: false,
        results: null,
        cost_usd: null,
        cost_source: null,
      });
      expect(s.estimate_usd).toBeGreaterThan(0);
      expect(llm.calls).toBe(callsBefore);
      const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteId, s.id));
      expect(runs).toHaveLength(12);
      expect(new Set(runs.map((r) => r.status))).toEqual(new Set(['queued']));
    });

    it('default carrier = the linked agent with the most runs with the skill', async () => {
      const skill = await createSkill();
      const a = await createAgent();
      const b = await createAgent();
      await addCases(skill.id, 1);
      for (const agent of [a, b]) {
        await app.inject({
          method: 'PUT',
          url: `/agents/${agent.id}/skills`,
          payload: { links: [{ skill_id: skill.id, enabled: true }] },
        });
      }
      const [run] = await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId, agentId: b.id, status: 'done', model: 'gpt-4.1' })
        .returning();
      await pg.handle.db
        .insert(t.runSkills)
        .values({ runId: run!.id, skillId: skill.id, skillVersion: 1, bodySha256: 'x', tokens: 5 });
      const res = await createSuite(app, skill.id, undefined, 'quick');
      expect(res.statusCode).toBe(201);
      expect(res.json().carrier_agent_id).toBe(b.id);

      const lonely = await createSkill();
      await addCases(lonely.id, 1);
      const none = await createSuite(app, lonely.id, undefined, 'quick');
      expect(none.statusCode).toBe(422);
      expect(none.json().error.code).toBe('eval_no_carrier');
    });

    it('trust gate: an unvetted imported skill is 409 until vetted', async () => {
      const skill = await createSkill({ source: 'imported' });
      const agent = await createAgent();
      await addCases(skill.id, 1);
      const blocked = await createSuite(app, skill.id, agent.id, 'quick');
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('eval_skill_not_vetted');
      const vet = await app.inject({ method: 'POST', url: `/skills/${skill.id}/vet`, payload: { version: skill.version } });
      expect(vet.statusCode).toBe(200);
      expect((await createSuite(app, skill.id, agent.id, 'quick')).statusCode).toBe(201);
    });

    it('422 when the carrier model has no price; 404 for an unknown carrier', async () => {
      const skill = await createSkill();
      await addCases(skill.id, 1);
      const agent = await createAgent('mystery-model-9000');
      const res = await createSuite(app, skill.id, agent.id, 'quick');
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('eval_price_unknown');
      expect((await createSuite(app, skill.id, crypto.randomUUID(), 'quick')).statusCode).toBe(404);
    });

    it('422 above 150 jobs (26 cases × 2 × 3)', async () => {
      const skill = await createSkill();
      const agent = await createAgent();
      await addCases(skill.id, 26);
      const full = await createSuite(app, skill.id, agent.id, 'full');
      expect(full.statusCode).toBe(422);
      expect(full.json().error.code).toBe('eval_too_many_jobs');
      expect((await createSuite(app, skill.id, agent.id, 'quick')).statusCode).toBe(201);
    });

    it('budget: an estimate above EVAL_MAX_BUDGET_USD is refused and nothing is stored', async () => {
      const poor = await makeApp(llm, { EVAL_MAX_BUDGET_USD: '0.0001' });
      const skill = await createSkill();
      const agent = await createAgent();
      await addCases(skill.id, 1);
      const res = await createSuite(poor, skill.id, agent.id, 'quick');
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('eval_budget_exceeded');
      const suites = await pg.handle.db.select().from(t.evalSuites).where(eq(t.evalSuites.skillId, skill.id));
      expect(suites).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- runner

  describe('runner', () => {
    let skill: { id: string; version: number; name: string };
    let agent: { id: string; name: string };
    let fullSuiteId: string;

    beforeAll(async () => {
      skill = await createSkill();
      agent = await createAgent();
      await addCases(skill.id, 5);
    });

    it('Full suite: concurrency 2, atomic close, per-case caught, verdict helps', async () => {
      const created = (await createSuite(app, skill.id, agent.id, 'full')).json();
      fullSuiteId = created.id;
      const callsBefore = llm.calls;
      llm.maxInFlight = 0;
      llm.awaitOverlap = true;
      const start = await app.inject({ method: 'POST', url: `/eval-suites/${created.id}/start` });
      expect(start.statusCode).toBe(200);
      expect(start.json().status).toBe('running');

      const done = await waitSuite(app, created.id);
      expect(done.status).toBe('done');
      expect(done.done_jobs).toBe(30);
      expect(done.total_jobs).toBe(30);
      expect(llm.calls - callsBefore).toBe(30);
      // Both slots of the dedicated runner were used, and never more.
      expect(llm.maxInFlight).toBe(2);
      expect(done.results).toEqual({
        passing: 5,
        total: 5,
        caught: 5,
        regressed: 0,
        flaky: 0,
        errored: 0,
        delta_unexpected: 0,
        verdict: 'helps',
      });
      expect(done.cases).toHaveLength(5);
      for (const c of done.cases) {
        expect(c.outcome).toBe('caught');
        expect(c.with).toEqual({ passed: 3, total: 3 });
        expect(c.without).toEqual({ passed: 0, total: 3 });
      }
      expect(done.runs).toHaveLength(30);
      expect(done.runs.every((r: { status: string }) => r.status === 'done')).toBe(true);
      expect(done.cost_usd).toBeCloseTo(30 * 0.002, 6);
      expect(done.cost_source).toBe('estimated');
      expect(done.finished_at).not.toBeNull();
      const withRun = done.runs.find((r: { arm: string }) => r.arm === 'with');
      expect(withRun).toMatchObject({ pass: true, matched: 1, expected: 1, unexpected: 0, citation_accuracy: 1 });
    });

    it('the done_jobs counter is atomic: of 40 concurrent counts exactly one sees done = total', async () => {
      const s = (await createSuite(app, skill.id, agent.id, 'quick')).json();
      await pg.handle.db
        .update(t.evalSuites)
        .set({ status: 'running', totalJobs: 40 })
        .where(eq(t.evalSuites.id, s.id));
      const counters = await Promise.all(
        Array.from({ length: 40 }, () => app.container.evalsRepo.countJob(s.id)),
      );
      const seen = counters.map((c) => c!.doneJobs).sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      expect(counters.filter((c) => c!.doneJobs === c!.totalJobs)).toHaveLength(1);
      await pg.handle.db.update(t.evalSuites).set({ status: 'cancelled' }).where(eq(t.evalSuites.id, s.id));
    });

    it('start replay is a no-op: same state, no new jobs, no LLM call', async () => {
      const jobsBefore = await evalJobCount();
      const callsBefore = llm.calls;
      const again = await app.inject({ method: 'POST', url: `/eval-suites/${fullSuiteId}/start` });
      expect(again.statusCode).toBe(200);
      expect(again.json().status).toBe('done');
      expect(await evalJobCount()).toBe(jobsBefore);
      expect(llm.calls).toBe(callsBefore);
    });

    it('a retried job (duplicate enqueue) creates no row, spends nothing and does not recount', async () => {
      const [run] = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteId, fullSuiteId));
      const callsBefore = llm.calls;
      const job = await app.container.evalJobs.enqueue(workspaceId, EVAL_RUN_JOB_KIND, {
        suiteId: fullSuiteId,
        runId: run!.id,
      });
      await job.done;
      expect(llm.calls).toBe(callsBefore);
      const rows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteId, fullSuiteId));
      expect(rows).toHaveLength(30);
      const [suite] = await pg.handle.db.select().from(t.evalSuites).where(eq(t.evalSuites.id, fullSuiteId));
      expect(suite!.doneJobs).toBe(30);
      // The idempotency key itself: a second row for the same job is refused.
      await expect(
        pg.handle.db.insert(t.evalRuns).values({
          caseId: run!.caseId,
          suiteId: fullSuiteId,
          arm: run!.arm,
          repeatIdx: run!.repeatIdx,
          status: 'queued',
        }),
      ).rejects.toThrow();
    });

    it('the latest Full verdict reaches GET /skills and the Stats impact block', async () => {
      const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
      const row = list.find((s: { id: string }) => s.id === skill.id);
      expect(row.latest_verdict).toEqual({ verdict: 'helps', carrier_name: agent.name, stale: false });

      const stats = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })).json();
      expect(stats.impact.verdict).toBe('helps');
      expect(stats.impact.stale).toBe(false);
      expect(stats.impact.suite.id).toBe(fullSuiteId);

      const other = list.find((s: { id: string; latest_verdict: unknown }) => s.id !== skill.id && s.latest_verdict);
      expect(other).toBeUndefined();
    });

    it('Quick never yields a verdict, even when every case is caught; Full stays the impact suite', async () => {
      const quick = (await createSuite(app, skill.id, agent.id, 'quick')).json();
      await app.inject({ method: 'POST', url: `/eval-suites/${quick.id}/start` });
      const done = await waitSuite(app, quick.id);
      expect(done.status).toBe('done');
      expect(done.results.caught).toBe(5);
      expect(done.results.verdict).toBe('indicative');

      const stats = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })).json();
      expect(stats.impact.suite.id).toBe(fullSuiteId);
      const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
      expect(list.find((s: { id: string }) => s.id === skill.id).latest_verdict.verdict).toBe('helps');
    });

    it('one running suite per workspace: a second start is 409 eval_suite_busy', async () => {
      const slow = new ScriptedLLM(150);
      const busyApp = await makeApp(slow);
      const a = (await createSuite(busyApp, skill.id, agent.id, 'quick')).json();
      const b = (await createSuite(busyApp, skill.id, agent.id, 'quick')).json();
      expect((await busyApp.inject({ method: 'POST', url: `/eval-suites/${a.id}/start` })).json().status).toBe('running');
      const second = await busyApp.inject({ method: 'POST', url: `/eval-suites/${b.id}/start` });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('eval_suite_busy');
      expect((await waitSuite(busyApp, a.id)).status).toBe('done');
      // Once A is done, B can start.
      await busyApp.inject({ method: 'POST', url: `/eval-suites/${b.id}/start` });
      expect((await waitSuite(busyApp, b.id)).status).toBe('done');
    });

    it('cancel: an estimated suite becomes cancelled; start after it is a no-op', async () => {
      const s = (await createSuite(app, skill.id, agent.id, 'quick')).json();
      const cancelled = await app.inject({ method: 'POST', url: `/eval-suites/${s.id}/cancel` });
      expect(cancelled.json().status).toBe('cancelled');
      expect((await app.inject({ method: 'POST', url: `/eval-suites/${s.id}/start` })).json().status).toBe('cancelled');
      expect((await app.inject({ method: 'POST', url: `/eval-suites/${s.id}/cancel` })).statusCode).toBe(200);
      const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteId, s.id));
      expect(runs.every((r) => r.status === 'failed')).toBe(true);
    });

    it('stale key: a description edit keeps the verdict; a body edit marks it stale and blocks start', async () => {
      const pending = (await createSuite(app, skill.id, agent.id, 'quick')).json();

      await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { description: 'reworded' } });
      let list = (await app.inject({ method: 'GET', url: '/skills' })).json();
      expect(list.find((s: { id: string }) => s.id === skill.id).latest_verdict.stale).toBe(false);

      await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: `Changed. ${TARGET_MARKER}` } });
      list = (await app.inject({ method: 'GET', url: '/skills' })).json();
      expect(list.find((s: { id: string }) => s.id === skill.id).latest_verdict).toMatchObject({
        verdict: 'helps',
        stale: true,
      });
      const stats = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })).json();
      expect(stats.impact.stale).toBe(true);

      const start = await app.inject({ method: 'POST', url: `/eval-suites/${pending.id}/start` });
      expect(start.statusCode).toBe(409);
      expect(start.json().error.code).toBe('eval_suite_stale');
    });
  });

  // ---------------------------------------------------------------- boot recovery

  it('boot recovery: an orphaned running run fails, queued runs re-run, the suite closes exactly once', async () => {
    const skill = await createSkill();
    const agent = await createAgent();
    await addCases(skill.id, 1);
    const s = (await createSuite(app, skill.id, agent.id, 'quick')).json();
    // Simulate a process that died mid-suite: suite running, one run in flight.
    await pg.handle.db
      .update(t.evalSuites)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(t.evalSuites.id, s.id));
    const [orphan] = await pg.handle.db
      .update(t.evalRuns)
      .set({ status: 'running' })
      .where(and(eq(t.evalRuns.suiteId, s.id), eq(t.evalRuns.arm, 'with')))
      .returning();

    const fresh = new ScriptedLLM();
    const rebooted = await makeApp(fresh);
    const done = await waitSuite(rebooted, s.id);
    expect(done.status).toBe('done');
    expect(done.done_jobs).toBe(2);
    expect(done.total_jobs).toBe(2);
    expect(fresh.calls).toBe(1);
    const orphanRow = done.runs.find((r: { id: string }) => r.id === orphan!.id);
    expect(orphanRow).toMatchObject({ status: 'failed', error: ORPHAN_RUN_ERROR });
    expect(done.cases[0].outcome).toBe('error');
    expect(done.results.verdict).toBe('indicative');
  });
});
