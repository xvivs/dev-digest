/**
 * Skill Stats = Usage + Cost (plan Phase 2) over HTTP + real Postgres:
 * `GET /skills/:id/stats?window=` on seeded runs (only completed runs count,
 * runs without `run_skills` are simply absent, the window bounds the range),
 * the enum guard on `window`, tenancy, and `GET /skills` carrying `runs_30d`
 * + `latest_verdict` from ONE query (query count, no N+1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SkillListItem, SkillStats } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { schema } from '../src/db/schema.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { estimateCost } from '../src/adapters/llm/pricing.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

d('skill stats (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'stats-other' }).returning();
    otherWorkspaceId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  const unique = (prefix: string) => `${prefix}-${++seq}-${Date.now()}`;

  async function createSkill(app: App, over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: unique('stats'), type: 'rubric', body: 'Stats body.', ...over },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string; version: number };
  }

  async function createAgent(app: App, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: unique(name), provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
    });
    expect(res.statusCode).toBeLessThan(300);
    return res.json() as { id: string; name: string };
  }

  /** A run as the executor leaves it; `skill` = its run_skills row, if any. */
  async function seedRun(opts: {
    agentId: string | null;
    status?: string;
    model?: string;
    daysAgo?: number;
    skill?: { id: string; version: number; tokens: number };
  }) {
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: opts.agentId,
        status: opts.status ?? 'done',
        model: opts.model ?? 'gpt-4.1',
        ranAt: new Date(Date.now() - (opts.daysAgo ?? 0) * DAY_MS),
      })
      .returning();
    if (opts.skill) {
      await pg.handle.db.insert(t.runSkills).values({
        runId: run!.id,
        skillId: opts.skill.id,
        skillVersion: opts.skill.version,
        bodySha256: 'a'.repeat(64),
        promptSha256: 'b'.repeat(64),
        tokens: opts.skill.tokens,
      });
    }
    return run!.id;
  }

  async function stats(app: App, skillId: string, query = '') {
    return app.inject({ method: 'GET', url: `/skills/${skillId}/stats${query}` });
  }

  it('aggregates completed runs by agent and version, prices skill tokens, honours the window', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const other = await createSkill(app);
    const alpha = await createAgent(app, 'alpha');
    const beta = await createAgent(app, 'beta');
    const linkRes = await app.inject({
      method: 'PUT',
      url: `/agents/${alpha.id}/skills`,
      payload: { links: [{ skill_id: skill.id, enabled: true }] },
    });
    expect(linkRes.statusCode).toBe(200);
    await app.inject({
      method: 'PUT',
      url: `/agents/${beta.id}/skills`,
      payload: { links: [{ skill_id: skill.id, enabled: false }] },
    });

    // Inside 30d: two completed runs of alpha (v1, v2) count.
    await seedRun({ agentId: alpha.id, daysAgo: 1, skill: { id: skill.id, version: 1, tokens: 100 } });
    await seedRun({ agentId: alpha.id, daysAgo: 2, skill: { id: skill.id, version: 2, tokens: 120 } });
    // Never counted: failed / running runs, a completed run without run_skills,
    // and another skill's run.
    await seedRun({ agentId: alpha.id, status: 'failed', skill: { id: skill.id, version: 2, tokens: 999 } });
    await seedRun({ agentId: alpha.id, status: 'running', skill: { id: skill.id, version: 2, tokens: 999 } });
    await seedRun({ agentId: alpha.id });
    await seedRun({ agentId: alpha.id, skill: { id: other.id, version: 1, tokens: 999 } });
    // 40 days ago, unpriced model, agent later deleted-like (null agent): only in 90d.
    await seedRun({ agentId: beta.id, daysAgo: 40, model: 'no-such-model', skill: { id: skill.id, version: 1, tokens: 50 } });
    await seedRun({ agentId: null, daysAgo: 60, skill: { id: skill.id, version: 1, tokens: 10 } });
    // Outside every window.
    await seedRun({ agentId: alpha.id, daysAgo: 120, skill: { id: skill.id, version: 1, tokens: 999 } });

    const res30 = await stats(app, skill.id);
    expect(res30.statusCode).toBe(200);
    const s30 = SkillStats.parse(res30.json());
    expect(s30.window).toBe('30d');
    expect(s30.impact).toBeNull();
    expect(s30.usage.runs).toBe(2);
    const agents = new Map(s30.usage.agents.map((a) => [a.agent_id, a]));
    expect(s30.usage.agents).toHaveLength(2);
    expect(agents.get(alpha.id)).toMatchObject({ agent_name: alpha.name, status: 'effective', runs: 2 });
    expect(agents.get(beta.id)).toMatchObject({ agent_name: beta.name, status: 'link_disabled', runs: 0 });
    expect(s30.cost.tokens).toBe(220);
    expect(s30.cost.cost_source).toBe('estimated');
    expect(s30.cost.cost_usd).toBeCloseTo(estimateCost('gpt-4.1', 220, 0)!, 12);
    expect(s30.by_version.map((v) => [v.version, v.runs, v.tokens])).toEqual([
      [2, 1, 120],
      [1, 1, 100],
    ]);

    const s7 = SkillStats.parse((await stats(app, skill.id, '?window=7d')).json());
    expect(s7.usage.runs).toBe(2);

    const s90 = SkillStats.parse((await stats(app, skill.id, '?window=90d')).json());
    expect(s90.usage.runs).toBe(4);
    expect(s90.cost.tokens).toBe(280);
    // The unpriced model adds tokens, not dollars.
    expect(s90.cost.cost_usd).toBeCloseTo(estimateCost('gpt-4.1', 110 + 120, 0)!, 12);
    expect(new Map(s90.usage.agents.map((a) => [a.agent_id, a.runs])).get(beta.id)).toBe(1);
    expect(s90.by_version.find((v) => v.version === 1)).toMatchObject({ runs: 3, tokens: 160 });

    // The status follows the skill itself: disabling it flips alpha's link.
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    const disabled = SkillStats.parse((await stats(app, skill.id)).json());
    expect(disabled.usage.agents.find((a) => a.agent_id === alpha.id)?.status).toBe('skill_disabled');
    await app.close();
  });

  it('a skill that never ran: zeros, empty by_version, null cost pair', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const s = SkillStats.parse((await stats(app, skill.id)).json());
    expect(s.usage).toEqual({ agents: [], runs: 0 });
    expect(s.cost).toEqual({ tokens: 0, cost_usd: null, cost_source: null });
    expect(s.by_version).toEqual([]);
    await app.close();
  });

  it('window outside the enum → 422 validation_error; unknown or foreign skill → 404', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    for (const bad of ['?window=1y', '?window=30', '?window=']) {
      const res = await stats(app, skill.id, bad);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    expect((await stats(app, '00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);

    const foreign = await new SkillsRepository(pg.handle.db).insert({
      workspaceId: otherWorkspaceId,
      name: unique('foreign'),
      description: '',
      type: 'rubric',
      source: 'manual',
      body: 'x',
      enabled: true,
      needsVetting: false,
    });
    expect((await stats(app, foreign.id)).statusCode).toBe(404);
    await app.close();
  });

  it('GET /skills carries runs_30d and latest_verdict (null = no evals)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const agent = await createAgent(app, 'lister');
    await seedRun({ agentId: agent.id, daysAgo: 3, skill: { id: skill.id, version: 1, tokens: 5 } });
    await seedRun({ agentId: agent.id, daysAgo: 45, skill: { id: skill.id, version: 1, tokens: 5 } });
    await seedRun({ agentId: agent.id, status: 'failed', skill: { id: skill.id, version: 1, tokens: 5 } });

    const res = await app.inject({ method: 'GET', url: `/skills?q=${skill.name}` });
    expect(res.statusCode).toBe(200);
    const [row] = SkillListItem.array().parse(res.json());
    expect(row).toMatchObject({ id: skill.id, runs_30d: 1, latest_verdict: null, agent_count: 0 });
    await app.close();
  });

  it('SkillsRepository.list is ONE query however many skills and runs there are (no N+1)', async () => {
    let queries = 0;
    const counting = drizzle(pg.handle.sql, { schema, logger: { logQuery: () => void queries++ } });
    const repo = new SkillsRepository(counting);
    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: unique('n-plus-one') }).returning();
    const insert = (name: string) =>
      new SkillsRepository(pg.handle.db).insert({
        workspaceId: ws!.id,
        name,
        description: '',
        type: 'rubric',
        source: 'manual',
        body: 'b',
        enabled: true,
        needsVetting: false,
      });

    await insert(unique('one'));
    queries = 0;
    expect(await repo.list(ws!.id)).toHaveLength(1);
    expect(queries).toBe(1);

    for (let i = 0; i < 5; i++) await insert(unique('many'));
    queries = 0;
    const rows = await repo.list(ws!.id);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.runs30d === 0 && r.latestVerdict === null)).toBe(true);
    expect(queries).toBe(1);
  });
});
