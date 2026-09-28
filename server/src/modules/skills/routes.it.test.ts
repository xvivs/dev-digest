/**
 * HTTP contract test — buildApp + inject over a real Postgres. Covers the
 * concerns that only exist at this tier: status codes, zod validation (422 on
 * invisible chars), 404 vs 409 mapping, and the wire DTO shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('skills routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    // `LocalNoAuthProvider` (getContext) resolves the request's workspace by
    // resolving the SEEDED default workspace + system user — seed() is not
    // optional here (server/AGENTS.md gotcha).
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

  const createBody = (over: Partial<Record<string, unknown>> = {}) => ({
    name: 'branch-coverage-gate',
    description: 'Flag untested branches.',
    type: 'rubric',
    body: 'Check every new conditional has a test.',
    ...over,
  });

  it('POST /skills (manual) → 201, enabled, not needing vetting', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody() });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.enabled).toBe(true);
    expect(skill.needs_vetting).toBe(false);
    expect(skill.source).toBe('manual');
    expect(skill.version).toBe(1);
    await app.close();
  });

  it('POST /skills (imported) → forced disabled + needs_vetting', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: createBody({ name: 'api-breaking-change', source: 'imported' }),
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.enabled).toBe(false);
    expect(skill.needs_vetting).toBe(true);
    await app.close();
  });

  it('POST /skills rejects a body with invisible/bidi-control characters (422)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: createBody({ name: 'invisible-body', body: 'Looks fine​but has a zero-width char.' }),
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('POST /skills rejects an unknown source (only manual/imported are creatable)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: createBody({ name: 'community-attempt', source: 'community' }),
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('POST /skills duplicate name in the workspace → 409', async () => {
    const app = await makeApp();
    await app.inject({ method: 'POST', url: '/skills', payload: createBody({ name: 'dup-route' }) });
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody({ name: 'dup-route' }) });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('GET /skills/:id for a skill in another workspace → 404', async () => {
    const app = await makeApp();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWorkspaceId,
        name: 'foreign-skill',
        description: '',
        type: 'rubric',
        source: 'manual',
        body: 'x',
      })
      .returning();
    const res = await app.inject({ method: 'GET', url: `/skills/${foreign!.id}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('PUT /skills/:id enabling an unvetted (imported) skill → 409; vet then enable → 200', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: createBody({ name: 'vet-flow', source: 'imported' }),
      })
    ).json();

    const blocked = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { enabled: true },
    });
    expect(blocked.statusCode).toBe(409);

    const vetted = await app.inject({ method: 'POST', url: `/skills/${created.id}/vet` });
    expect(vetted.statusCode).toBe(200);
    expect(vetted.json().needs_vetting).toBe(false);

    const enabled = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().enabled).toBe(true);
    await app.close();
  });

  it('PUT /skills/:id editing the body of an imported skill resets needs_vetting; version bumps', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: createBody({ name: 'reset-on-edit', source: 'imported' }),
      })
    ).json();
    await app.inject({ method: 'POST', url: `/skills/${created.id}/vet` });

    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: 'A materially different body.' },
    });
    expect(edited.statusCode).toBe(200);
    const skill = edited.json();
    expect(skill.needs_vetting).toBe(true);
    expect(skill.version).toBe(2);

    const versions = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, created.id));
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('DELETE /skills/:id removes it; a second delete 404s', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody({ name: 'to-delete' }) })
    ).json();
    expect((await app.inject({ method: 'DELETE', url: `/skills/${created.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/skills/${created.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('GET /skills?q= filters by name/description; response carries agent_count', async () => {
    const app = await makeApp();
    await app.inject({
      method: 'POST',
      url: '/skills',
      payload: createBody({ name: 'searchable-marker-xyz' }),
    });
    const res = await app.inject({ method: 'GET', url: '/skills?q=searchable-marker' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toHaveProperty('agent_count');
    await app.close();
  });
});
