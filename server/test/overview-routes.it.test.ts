/**
 * Spec 06: GET /pulls/:id/overview/readiness and POST /pulls/:id/overview/prepare
 * end to end over a real Postgres (Testcontainers). The real repo-intel facade
 * and clone facade run (so `jobs` rows are the evidence); MockGitClient gives
 * the clone HEAD and a `prBrief` stub replaces the LLM brief.
 * (AC-1..AC-7, AC-9, AC-12, AC-18, AC-20..AC-22.)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { PrOverviewReadiness, type BriefFailure } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { PrBriefFacade, PrIntentView, PrRisksView } from '../src/modules/brief/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const HEAD = 'clone-head-1';
const config = (env: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);

function briefStub(opts: { fresh?: boolean; failure?: BriefFailure | null } = {}) {
  const fresh = opts.fresh ?? true;
  const view = (): PrIntentView & PrRisksView =>
    ({ record: fresh ? ({} as never) : null, stale: false, inFlight: false, lastFailure: opts.failure ?? null }) as never;
  const requestDerive = vi.fn(async () => ({ queued: true }));
  const stub = {
    getIntent: async () => view(),
    getRisks: async () => view(),
    requestDerive,
  } as unknown as PrBriefFacade;
  return { stub, requestDerive };
}

d('overview routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let seq = 0;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-ws' }).returning();
    otherWorkspaceId = other!.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const app of apps.splice(0)) {
      await app.container.jobs.onIdle();
      await app.close();
    }
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(opts: { env?: Record<string, string>; brief?: ReturnType<typeof briefStub> } = {}) {
    const brief = opts.brief ?? briefStub();
    const github = new MockGitHubClient();
    const app = await buildApp({
      config: config(opts.env),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ head: HEAD }),
        github,
        prBrief: brief.stub,
      },
    });
    apps.push(app);
    return { app, github, brief };
  }

  /** A repo (cloned or not) with one PR and an optional index row. */
  async function fixture(opts: {
    cloned?: boolean;
    index?: { status: 'full' | 'partial' | 'degraded'; sha: string } | null;
    workspace?: string;
  } = {}) {
    const n = ++seq;
    const ws = opts.workspace ?? workspaceId;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'acme',
        name: `ov-${n}`,
        fullName: `acme/ov-${n}`,
        clonePath: opts.cloned === false ? null : `/nonexistent/clones/ov-${n}`,
      })
      .returning();
    if (opts.index) {
      await pg.handle.db.insert(t.repoIndexState).values({
        repoId: repo!.id,
        lastIndexedSha: opts.index.sha,
        indexerVersion: INDEXER_VERSION,
        status: opts.index.status,
        stats: opts.index.status === 'partial' ? { softBudgetReached: true } : {},
      });
    }
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 8000 + n,
        title: 'Overview PR',
        author: 'sam',
        branch: 'feat',
        base: 'main',
        headSha: 'head-1',
      })
      .returning();
    return { repoId: repo!.id, prId: pr!.id };
  }

  const jobKinds = async (repoId: string) =>
    (
      await pg.handle.db
        .select({ kind: t.jobs.kind })
        .from(t.jobs)
        .where(sql`${t.jobs.payload}->>'repoId' = ${repoId}`)
    ).map((r) => r.kind);

  it('the migration added repo_index_state.last_indexed_at', async () => {
    const rows = await pg.handle.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'repo_index_state' and column_name = 'last_indexed_at'`,
    );
    expect(rows.length).toBe(1);
  });

  it('GET parses as PrOverviewReadiness and makes no GitHub, LLM or blast call', async () => {
    const llm = vi.spyOn(Container.prototype, 'llm');
    const blast = vi.spyOn(RepoIntelService.prototype, 'getBlastRadius');
    const { app, github } = await appWith();
    const pullRequest = vi.spyOn(github, 'getPullRequest');
    const { prId } = await fixture({ index: { status: 'full', sha: HEAD } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/overview/readiness` });
    expect(res.statusCode).toBe(200);
    const body = PrOverviewReadiness.parse(res.json());
    expect(body.index.status).toBe('full');
    expect(body.actions).toEqual([]);
    expect(pullRequest).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
    expect(blast).not.toHaveBeenCalled();
  });

  it('a PR of another workspace is 404 on both routes', async () => {
    const { app } = await appWith();
    const { prId } = await fixture({ workspace: otherWorkspaceId });
    expect((await app.inject({ method: 'GET', url: `/pulls/${prId}/overview/readiness` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} })).statusCode).toBe(404);
  });

  it('no clone → one clone job from the request, no index job', async () => {
    const { app } = await appWith({ brief: briefStub({ fresh: false }) });
    const { repoId, prId } = await fixture({ cloned: false });
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'started', started: ['clone'] });
    // The request enqueued only the clone; the finished clone requests the full index itself.
    await app.container.jobs.onIdle();
    expect((await jobKinds(repoId)).sort()).toEqual(['clone', 'repo-intel-index']);
  });

  it('full index at the clone HEAD + fresh brief → 202 skipped, no job', async () => {
    const { app, brief } = await appWith();
    const { repoId, prId } = await fixture({ index: { status: 'full', sha: HEAD } });
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'skipped', started: [], failed: [] });
    expect(await jobKinds(repoId)).toEqual([]);
    expect(brief.requestDerive).not.toHaveBeenCalled();
  });

  it('partial at another sha → one repo-intel-index job', async () => {
    const { app } = await appWith();
    const { repoId, prId } = await fixture({ index: { status: 'partial', sha: 'older' } });
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} });
    expect(res.json()).toMatchObject({ status: 'started', started: ['index_full'] });
    expect(await jobKinds(repoId)).toEqual(['repo-intel-index']);
  });

  it('partial at the clone HEAD: {} skipped, { reindex_partial: true } → one full index, unknown key → 422, no payload → 202', async () => {
    const { app } = await appWith();
    const { repoId, prId } = await fixture({ index: { status: 'partial', sha: HEAD } });
    const url = `/pulls/${prId}/overview/prepare`;

    const ready = PrOverviewReadiness.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/overview/readiness` })).json(),
    );
    expect(ready.actions).toEqual([]);
    expect(ready.explicit_actions).toEqual(['reindex_partial']);
    expect(ready.index.partial_reason).toBe('soft_budget');

    expect((await app.inject({ method: 'POST', url, payload: {} })).json()).toMatchObject({ status: 'skipped' });
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(202);
    expect(await jobKinds(repoId)).toEqual([]);

    expect((await app.inject({ method: 'POST', url, payload: { foo: 1 } })).statusCode).toBe(422);

    const res = await app.inject({ method: 'POST', url, payload: { reindex_partial: true } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'started', started: ['reindex_partial'] });
    expect(res.json().readiness.in_flight).toBe(true);
    expect(await jobKinds(repoId)).toEqual(['repo-intel-index']);
  });

  it('REPO_INTEL_ENABLED=false → flag_off and no clone or index job', async () => {
    const { app } = await appWith({ env: { REPO_INTEL_ENABLED: 'false' } });
    const { repoId, prId } = await fixture({ cloned: false });
    const r = PrOverviewReadiness.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/overview/readiness` })).json(),
    );
    expect(r.index.status).toBe('flag_off');
    expect(r.actions).toEqual([]);
    await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} });
    expect(await jobKinds(repoId)).toEqual([]);
  });

  it('two concurrent prepares → one index job; the brief is asked on_demand + onlyIfIdle', async () => {
    // A real full index outlives a request; hold it so the fixture's empty
    // clone cannot finish it between the two requests' reads.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.spyOn(RepoIntelService.prototype, 'indexRepo').mockImplementation(async () => {
      await held;
      return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    });
    const { app, brief } = await appWith({ brief: briefStub({ fresh: false }) });
    const { repoId, prId } = await fixture({ index: null });
    const url = `/pulls/${prId}/overview/prepare`;
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url, payload: {} }),
      app.inject({ method: 'POST', url, payload: {} }),
    ]);
    release();
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect((await jobKinds(repoId)).filter((k) => k === 'repo-intel-index')).toHaveLength(1);
    expect(brief.requestDerive).toHaveBeenCalledWith(workspaceId, prId, 'on_demand', { onlyIfIdle: true });
  });

  it('Refresh repo + prepare { reindex_partial: true } at once → at most one full index', async () => {
    const { app } = await appWith();
    const { repoId, prId } = await fixture({ index: { status: 'partial', sha: HEAD } });
    await Promise.all([
      app.inject({ method: 'POST', url: `/repos/${repoId}/refresh` }),
      app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: { reindex_partial: true } }),
    ]);
    await app.container.jobs.onIdle();
    const kinds = await jobKinds(repoId);
    expect(kinds.filter((k) => k === 'repo-intel-index').length).toBeLessThanOrEqual(1);
    expect(kinds.filter((k) => k === 'clone')).toHaveLength(1);
  });

  it('head_moved blocks derive_brief', async () => {
    const { app, brief } = await appWith({ brief: briefStub({ fresh: false, failure: { reason: 'head_moved', at: 'x' } }) });
    const { prId } = await fixture({ index: { status: 'full', sha: HEAD } });
    const r = PrOverviewReadiness.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/overview/readiness` })).json(),
    );
    expect(r.blocked_by).toBe('head_moved');
    expect(r.actions).toEqual([]);
    await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} });
    expect(brief.requestDerive).not.toHaveBeenCalled();
  });

  it('provider_not_configured blocks derive_brief and prepare never asks the brief', async () => {
    const { app, brief } = await appWith({
      brief: briefStub({ fresh: false, failure: { reason: 'provider_not_configured', at: 'x' } }),
    });
    const { prId } = await fixture({ index: { status: 'full', sha: HEAD } });
    const r = PrOverviewReadiness.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/overview/readiness` })).json(),
    );
    expect(r.blocked_by).toBe('provider_not_configured');
    expect(r.actions).toEqual([]);
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/overview/prepare`, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'skipped', started: [] });
    expect(brief.requestDerive).not.toHaveBeenCalled();
  });

  it('POST with a literal JSON null body is treated as {}', async () => {
    const { app } = await appWith();
    const { repoId, prId } = await fixture({ index: { status: 'full', sha: HEAD } });
    const url = `/pulls/${prId}/overview/prepare`;
    const headers = { 'content-type': 'application/json' };
    const asNull = await app.inject({ method: 'POST', url, headers, payload: 'null' });
    expect(asNull.statusCode).toBe(202);
    expect(asNull.json()).toMatchObject({ status: 'skipped' });
    expect(await jobKinds(repoId)).toEqual([]);
  });

  it('POST /repos/:id/resync for a repo of another workspace → 404, no job', async () => {
    const { app } = await appWith();
    const { repoId } = await fixture({ workspace: otherWorkspaceId });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/resync` });
    expect(res.statusCode).toBe(404);
    expect(await jobKinds(repoId)).toEqual([]);
  });

  it('POST /repos/:id/resync for an own repo → 202 through the gate', async () => {
    const { app } = await appWith();
    const { repoId } = await fixture({ index: { status: 'full', sha: HEAD } });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/resync` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'accepted' });
    expect(await jobKinds(repoId)).toEqual(['repo-intel-resync']);
  });
});
