/**
 * Boot-time reaping of `running` agent_runs, against a real Postgres.
 *
 * Regression: every `buildApp()` reaped, so an in-process app that shares the
 * DB with a live API (a unit test whose config came from `.env`) flipped the
 * live API's in-flight run to `failed` with no error / duration / trace; the
 * run then finished and turned `done`. Reaping is now opt-in (`reapOnBoot`),
 * owned by `server.ts` alone.
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

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;`;

const REVIEW_FIXTURE: Review = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

/** An LLM whose first call blocks until released — holds the run in `running`. */
function gatedLlm() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const released = new Promise<void>((r) => (release = r));
  const llm: LLMProvider = {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      enter();
      await released;
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
  return { llm, entered, release };
}

d('boot-time run reaping (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    // Every status a run passes through, in order — catches a transient `failed`.
    await pg.handle.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS test_reap_probe (seq serial, run_id uuid, status text);
      CREATE OR REPLACE FUNCTION test_reap_probe_fn() RETURNS trigger AS $$
      BEGIN
        INSERT INTO test_reap_probe (run_id, status) VALUES (NEW.id, NEW.status);
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS test_reap_probe_trg ON agent_runs;
      CREATE TRIGGER test_reap_probe_trg AFTER UPDATE OF status ON agent_runs
        FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION test_reap_probe_fn();
    `);
  });
  afterAll(async () => {
    await pg?.handle.sql.unsafe(`DROP TRIGGER IF EXISTS test_reap_probe_trg ON agent_runs;`);
    await pg?.stop();
  });

  const transitions = async (runId: string) =>
    (
      await pg.handle.sql<{ status: string }[]>`
        SELECT status FROM test_reap_probe WHERE run_id = ${runId} ORDER BY seq`
    ).map((r) => r.status);

  async function insertPr() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `reap-repo-${suffix}`, fullName: `acme/reap-repo-${suffix}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 5,
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
    return pr!;
  }

  it('an in-process app booting on the same DB leaves a live run alone', async () => {
    const gate = gatedLlm();
    const live = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: { openai: gate.llm } },
    });
    const pr = await insertPr();
    const agent = (
      await live.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `reap-agent-${pr.id}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();
    const res = await live.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    expect(res.statusCode).toBe(200);
    const runId: string = res.json().runs[0].run_id;
    await gate.entered; // the run is mid-LLM-call, status `running`

    // A second app on the same DB — what a unit test built from `.env` is.
    const bystander = await buildApp({ config: config(), db: pg.handle.db });
    await bystander.close();
    const [mid] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(mid!.status).toBe('running');

    gate.release();
    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(run!.status).toBe('done');
    expect(await transitions(runId)).toEqual(['done']);
    await live.close();
  });

  it('reapOnBoot: true marks orphaned running runs failed', async () => {
    const pr = await insertPr();
    const [orphan] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'running', source: 'local' })
      .returning({ id: t.agentRuns.id });
    const app = await buildApp({ config: config(), db: pg.handle.db, reapOnBoot: true });
    const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, orphan!.id));
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('Interrupted by server restart');
    await app.close();
  });
});
