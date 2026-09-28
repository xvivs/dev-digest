/**
 * `PUT /agents/:id/skills` (SPEC-02) — replaces the old multiplexed
 * `POST /agents/:id/skills`. Covers: cross-tenant skill_id → 404 with NO
 * partial write, the enabled-skills body budget → 422, atomic replace, and
 * `skill_count` on the agent DTO (list + single).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('PUT /agents/:id/skills (Testcontainers pg)', () => {
  let pg: PgFixture;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    otherWorkspaceId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Agent-${Date.now()}-${Math.random()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
    });
    return res.json();
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>, over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: '',
        type: 'rubric',
        body: 'A short skill body.',
        ...over,
      },
    });
    return res.json();
  }

  it('replaces the link set: order = array index, returns AgentSkillLink[]', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const s1 = await createSkill(app);
    const s2 = await createSkill(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: s2.id, enabled: true }, { skill_id: s1.id, enabled: false }] },
    });
    expect(res.statusCode).toBe(200);
    const links = res.json();
    expect(links).toHaveLength(2);
    expect(links.find((l: { skill_id: string }) => l.skill_id === s2.id)).toMatchObject({ order: 0, enabled: true });
    expect(links.find((l: { skill_id: string }) => l.skill_id === s1.id)).toMatchObject({ order: 1, enabled: false });
    await app.close();
  });

  it('rejects duplicate skill_id in the same request (422, contract-level)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const s1 = await createSkill(app);
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: s1.id, enabled: true }, { skill_id: s1.id, enabled: false }] },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('a cross-tenant skill_id → 404, and the PREVIOUS link set is left untouched (no partial write)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const mine = await createSkill(app);

    // Seed an initial, known-good link set.
    const initial = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: mine.id, enabled: true }] },
    });
    expect(initial.statusCode).toBe(200);

    const [foreignSkill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWorkspaceId,
        name: `foreign-${Date.now()}`,
        description: '',
        type: 'rubric',
        source: 'manual',
        body: 'x',
      })
      .returning();

    const attempt = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: foreignSkill!.id, enabled: true }] },
    });
    expect(attempt.statusCode).toBe(404);

    // No partial write: the link set is exactly what it was before the failed PUT.
    const after = await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` });
    const links = after.json();
    expect(links).toHaveLength(1);
    expect(links[0].skill_id).toBe(mine.id);
    await app.close();
  });

  it('enabled skills over the 24 KB budget → 422, no write', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const big = await createSkill(app, { body: 'x'.repeat(20_000) });
    const alsoBig = await createSkill(app, { body: 'y'.repeat(20_000) });

    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: {
        links: [
          { skill_id: big.id, enabled: true },
          { skill_id: alsoBig.id, enabled: true },
        ],
      },
    });
    expect(res.statusCode).toBe(422);

    const after = await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` });
    expect(after.json()).toHaveLength(0);
    await app.close();
  });

  it('a disabled LINK does not count toward the budget, even for an oversized skill', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const big = await createSkill(app, { body: 'z'.repeat(30_000) });

    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: big.id, enabled: false }] },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('skill_count on the agent DTO = number of ENABLED links (list is one aggregate query)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const s1 = await createSkill(app);
    const s2 = await createSkill(app);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: {
        links: [
          { skill_id: s1.id, enabled: true },
          { skill_id: s2.id, enabled: false },
        ],
      },
    });

    const single = await app.inject({ method: 'GET', url: `/agents/${agent.id}` });
    expect(single.json().skill_count).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/agents' });
    const fromList = list.json().find((a: { id: string }) => a.id === agent.id);
    expect(fromList.skill_count).toBe(1);
    await app.close();
  });

  it('a config-bumping PUT /agents/:id snapshots skill_links alongside skills in agent_versions', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const s1 = await createSkill(app);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: s1.id, enabled: true }] },
    });
    // Any config change (not just enabled toggling) bumps the version + snapshots.
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { model: 'gpt-4o' } });

    const versions = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agent.id));
    const snapshot = versions.find((v) => v.version === 2);
    expect(snapshot).toBeDefined();
    const cfg = snapshot!.configJson as {
      skills: string[];
      skill_links: { skill_id: string; enabled: boolean; order: number }[];
    };
    expect(cfg.skills).toContain(s1.id);
    expect(cfg.skill_links).toEqual([{ skill_id: s1.id, enabled: true, order: 0 }]);
    await app.close();
  });
});
