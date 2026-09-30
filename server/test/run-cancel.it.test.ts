/**
 * Manual cancel of a review run (POST /runs/:id/cancel), against a real
 * Postgres: the in-flight LLM request is aborted, the trace lands BEFORE the
 * run turns `cancelled`, and a late LLM answer cannot flip it back to `done`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

/**
 * An LLM whose call blocks until released. `honourSignal` makes it reject on
 * abort (a real SDK with a signal); without it the call ignores the abort and
 * answers when released (the "answer was already on its way" race).
 */
function gatedLlm(honourSignal: boolean) {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const released = new Promise<void>((r) => (release = r));
  const seen: { signal?: AbortSignal } = {};
  const llm: LLMProvider = {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      seen.signal = req.signal;
      enter();
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve);
        if (honourSignal) {
          req.signal?.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')), {
            once: true,
          });
        }
      });
      return {
        data: req.schema.parse(REVIEW_FIXTURE),
        model: req.model,
        tokensIn: 1,
        tokensOut: 1,
        costUsd: null,
        costSource: null,
        raw: JSON.stringify(REVIEW_FIXTURE),
        attempts: 1,
      };
    },
    async complete() {
      throw new Error('unused');
    },
    async embed() {
      throw new Error('unused');
    },
    async listModels() {
      return [];
    },
  };
  return { llm, entered, release, seen };
}

d('manual run cancel (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    // Snapshot "does the trace exist?" at the instant a run turns terminal.
    await pg.handle.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS test_cancel_probe (run_id uuid, status text, trace_present boolean);
      CREATE OR REPLACE FUNCTION test_cancel_probe_fn() RETURNS trigger AS $$
      BEGIN
        INSERT INTO test_cancel_probe
          VALUES (NEW.id, NEW.status, EXISTS (SELECT 1 FROM run_traces WHERE run_id = NEW.id));
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS test_cancel_probe_trg ON agent_runs;
      CREATE TRIGGER test_cancel_probe_trg AFTER UPDATE OF status ON agent_runs
        FOR EACH ROW WHEN (NEW.status IN ('done', 'failed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION test_cancel_probe_fn();
    `);
  });
  afterAll(async () => {
    await pg?.handle.sql.unsafe(`DROP TRIGGER IF EXISTS test_cancel_probe_trg ON agent_runs;`);
    await pg?.stop();
  });

  const probesFor = (runId: string) =>
    pg.handle.sql<{ status: string; trace_present: boolean }[]>`
      SELECT status, trace_present FROM test_cancel_probe WHERE run_id = ${runId}`;

  async function setupPr(app: Awaited<ReturnType<typeof buildApp>>) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `cancel-repo-${suffix}`, fullName: `acme/cancel-repo-${suffix}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'PR',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `cancel-agent-${suffix}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();
    return { pr: pr!, agent };
  }

  async function startRun(llm: LLMProvider) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: { openai: llm } },
    });
    const { pr, agent } = await setupPr(app);
    const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    return { app, pr, runId: started.json().runs[0].run_id as string };
  }

  /** Poll until the executor has written its own cancel trace (log line). */
  async function waitForExecutorCancelTrace(app: Awaited<ReturnType<typeof buildApp>>, runId: string) {
    for (let i = 0; i < 200; i++) {
      const res = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (res.statusCode === 200 && JSON.stringify(res.json().log).includes('Run cancelled by user')) return res;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('executor never wrote its cancel trace');
  }

  it('cancel mid-LLM-call aborts the request, writes the trace first, and the trace opens', async () => {
    const gate = gatedLlm(true);
    const { app, pr, runId } = await startRun(gate.llm);
    await gate.entered;

    const cancel = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    // The in-flight request's signal fired — the socket would be closed now.
    expect(gate.seen.signal?.aborted).toBe(true);

    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(run?.status).toBe('cancelled');
    const trace = await waitForExecutorCancelTrace(app, runId);
    expect(trace.json().stats.cost_missing_reason).toBe('failed');
    expect(await probesFor(runId)).toEqual([{ status: 'cancelled', trace_present: true }]);
    // Still cancelled after the executor's own write; no review persisted.
    const [after] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(after?.status).toBe('cancelled');
    expect(await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.runId, runId))).toEqual([]);
    await app.close();
  });

  it('an LLM answer that arrives after the cancel does not flip the run to done', async () => {
    const gate = gatedLlm(false);
    const { app, runId } = await startRun(gate.llm);
    await gate.entered;
    await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    gate.release();
    await waitForExecutorCancelTrace(app, runId);

    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run?.status).toBe('cancelled');
    expect(await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.runId, runId))).toEqual([]);
    expect(await probesFor(runId)).toEqual([{ status: 'cancelled', trace_present: true }]);
    await app.close();
  });

  it('cancelling an orphaned running row (no executor) still leaves a readable trace', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: { openai: gatedLlm(true).llm } },
    });
    const { pr } = await setupPr(app);
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, provider: 'openai', model: 'gpt-4.1', status: 'running', source: 'local' })
      .returning({ id: t.agentRuns.id });
    const runId = row!.id;

    expect((await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` })).statusCode).toBe(200);
    const trace = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
    expect(trace.statusCode).toBe(200);
    expect(trace.json().config).toMatchObject({ model: 'gpt-4.1', pr: 7 });
    expect(JSON.stringify(trace.json().log)).toContain('Cancellation requested');
    expect(await probesFor(runId)).toEqual([{ status: 'cancelled', trace_present: true }]);
    await app.close();
  });
});
