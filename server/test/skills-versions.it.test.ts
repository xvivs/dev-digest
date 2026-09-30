import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SKILL_BODY_MAX } from '../src/modules/_shared/skill-limits.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-versions] Docker not available — skipping integration tests.');
}

/**
 * Skill version history (ADR 0016, plan Phase 1) over HTTP + real Postgres:
 * v1 on insert, bump on any content field but not `enabled`, the list/one
 * read endpoints, `vet` going stale after a rename, and the guarded,
 * append-only restore (409 / no-op / limits / name clash / vetting per source).
 */
d('skill versions (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
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

  const uniqueName = (prefix: string) => `${prefix}-${++seq}-${Date.now()}`;

  async function createSkill(
    app: Awaited<ReturnType<typeof makeApp>>,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; name: string; version: number }> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: uniqueName('versioned'),
        description: 'First description.',
        type: 'rubric',
        body: 'Body one.',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function put(app: Awaited<ReturnType<typeof makeApp>>, id: string, payload: object) {
    return app.inject({ method: 'PUT', url: `/skills/${id}`, payload });
  }

  async function snapshots(skillId: string) {
    return pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(t.skillVersions.version);
  }

  // ---- snapshot v1 + bump rules ------------------------------------------

  it('POST /skills writes a v1 snapshot of every field', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        skill_id: skill.id,
        version: 1,
        name: skill.name,
        description: 'First description.',
        type: 'rubric',
        change_note: null,
        created_at: expect.any(String),
      },
    ]);
    await app.close();
  });

  it('bumps on a name, description, type or body change; never on enabled', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    expect((await put(app, skill.id, { enabled: false })).json().version).toBe(1);
    expect((await put(app, skill.id, { enabled: true })).json().version).toBe(1);
    // Sending an unchanged value is not a change.
    expect((await put(app, skill.id, { body: 'Body one.' })).json().version).toBe(1);

    const renamed = uniqueName('renamed');
    expect((await put(app, skill.id, { name: renamed })).json().version).toBe(2);
    expect((await put(app, skill.id, { description: 'Second.' })).json().version).toBe(3);
    expect((await put(app, skill.id, { type: 'security' })).json().version).toBe(4);
    const last = await put(app, skill.id, { body: 'Body five.', change_note: '  sharper rule  ' });
    expect(last.statusCode).toBe(200);
    expect(last.json().version).toBe(5);

    const rows = await snapshots(skill.id);
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[4]).toMatchObject({
      name: renamed,
      description: 'Second.',
      type: 'security',
      body: 'Body five.',
      changeNote: 'sharper rule',
    });
    expect(rows[1]).toMatchObject({ name: renamed, description: 'First description.', type: 'rubric' });
    await app.close();
  });

  it('PUT change_note: blank is stored as null, over the limit is 422', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    await put(app, skill.id, { body: 'Changed.', change_note: '   ' });
    expect((await snapshots(skill.id))[1]?.changeNote).toBeNull();
    expect((await put(app, skill.id, { body: 'Again.', change_note: 'x'.repeat(501) })).statusCode).toBe(422);
    await app.close();
  });

  // ---- read endpoints -----------------------------------------------------

  it('GET /versions is newest first without bodies; GET /versions/:v returns the body', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    await put(app, skill.id, { body: 'Body two.', change_note: 'second' });

    const list = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
    expect(list.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(list[0]).not.toHaveProperty('body');
    expect(list[0].change_note).toBe('second');

    const one = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions/1` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ version: 1, body: 'Body one.', name: skill.name });
    await app.close();
  });

  it('GET /versions/:v → 422 non-numeric, 404 unknown version / skill / other workspace', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions/abc` })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions/0` })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions/99` })).statusCode).toBe(404);

    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${missing}/versions` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${missing}/versions/1` })).statusCode).toBe(404);

    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWorkspaceId,
        name: uniqueName('foreign'),
        description: '',
        type: 'rubric',
        source: 'manual',
        body: 'Not yours.',
      })
      .returning();
    await pg.handle.db.insert(t.skillVersions).values({ skillId: foreign!.id, version: 1, body: 'Not yours.' });
    expect((await app.inject({ method: 'GET', url: `/skills/${foreign!.id}/versions` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${foreign!.id}/versions/1` })).statusCode).toBe(404);
    const restore = await app.inject({
      method: 'POST',
      url: `/skills/${foreign!.id}/versions/1/restore`,
      payload: { expected_version: 1 },
    });
    expect(restore.statusCode).toBe(404);
    await app.close();
  });

  // ---- vet goes stale after a rename --------------------------------------

  it('vet → 409 skill_vet_stale when the skill was renamed during review', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, { source: 'imported' });
    expect(skill.version).toBe(1);
    await put(app, skill.id, { name: uniqueName('renamed-under-review') });

    const res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/vet`, payload: { version: 1 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'skill_vet_stale',
      details: { expected_version: 1, current_version: 2 },
    });
    const ok = await app.inject({ method: 'POST', url: `/skills/${skill.id}/vet`, payload: { version: 2 } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  // ---- restore ------------------------------------------------------------

  it('restore is append-only: vN becomes v(current+1), earlier snapshots untouched', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const renamed = uniqueName('renamed');
    await put(app, skill.id, { name: renamed, type: 'security', body: 'Body two.' });
    const before = await snapshots(skill.id);

    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      restored: true,
      skill: { version: 3, name: skill.name, type: 'rubric', body: 'Body one.' },
    });

    const after = await snapshots(skill.id);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toMatchObject({
      version: 3,
      name: skill.name,
      description: 'First description.',
      type: 'rubric',
      body: 'Body one.',
      changeNote: 'Restored from v1',
    });
    await app.close();
  });

  it('restore with a stale expected_version → 409 skill_version_stale, nothing written', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    await put(app, skill.id, { body: 'Body two.' });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'skill_version_stale',
      details: { expected_version: 1, current_version: 2 },
    });
    expect(await snapshots(skill.id)).toHaveLength(2);
    await app.close();
  });

  it('restore of the current state is a 200 no-op, and the no-op still checks expected_version', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    await put(app, skill.id, { body: 'Body two.' });
    await put(app, skill.id, { body: 'Body one.' }); // v3 content == v1 content

    const noop = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 3 },
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json()).toMatchObject({ restored: false, skill: { version: 3 } });
    expect(await snapshots(skill.id)).toHaveLength(3);

    const staleNoop = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 2 },
    });
    expect(staleNoop.statusCode).toBe(409);
    await app.close();
  });

  it('restore: 404 unknown version, 422 missing / extra body fields and non-numeric version', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const url = (v: string) => `/skills/${skill.id}/versions/${v}/restore`;
    expect((await app.inject({ method: 'POST', url: url('9'), payload: { expected_version: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: url('1'), payload: {} })).statusCode).toBe(422);
    expect(
      (await app.inject({ method: 'POST', url: url('1'), payload: { expected_version: 1, body: 'x' } })).statusCode,
    ).toBe(422);
    expect((await app.inject({ method: 'POST', url: url('v1'), payload: { expected_version: 1 } })).statusCode).toBe(422);
    await app.close();
  });

  it('restore re-applies the ADR 0012 body limits to the snapshot (422)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    await put(app, skill.id, { body: 'Body two.' });
    // A snapshot the current rules would refuse (written under looser rules or tampered with).
    await pg.handle.db
      .update(t.skillVersions)
      .set({ body: 'x'.repeat(SKILL_BODY_MAX + 1) })
      .where(and(eq(t.skillVersions.skillId, skill.id), eq(t.skillVersions.version, 1)));
    const tooLong = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 2 },
    });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json().error.code).toBe('validation_error');

    await pg.handle.db
      .update(t.skillVersions)
      .set({ body: 'hidden​char' })
      .where(and(eq(t.skillVersions.skillId, skill.id), eq(t.skillVersions.version, 1)));
    const invisible = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 2 },
    });
    expect(invisible.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json().version).toBe(2);
    await app.close();
  });

  it('restore of a name another skill has taken since → 409 skill_name_taken', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const oldName = skill.name;
    await put(app, skill.id, { name: uniqueName('moved-away') });
    await createSkill(app, { name: oldName });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('skill_name_taken');
    expect(await snapshots(skill.id)).toHaveLength(2); // the savepoint rolled back the bump
    await app.close();
  });

  it('restore of a legacy snapshot (body only) keeps the current metadata', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);
    const renamed = uniqueName('renamed');
    await put(app, skill.id, { name: renamed, body: 'Body two.' });
    await pg.handle.db
      .update(t.skillVersions)
      .set({ name: null, description: null, type: null })
      .where(and(eq(t.skillVersions.skillId, skill.id), eq(t.skillVersions.version, 1)));
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/versions/1/restore`,
      payload: { expected_version: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skill).toMatchObject({ version: 3, name: renamed, body: 'Body one.' });
    await app.close();
  });

  /**
   * ADR 0016 §7: restore resets vetting under exactly the rule an edit uses.
   * For every `source`, one skill gets a PUT body edit and its twin gets a
   * restore to the same body; both must end in the same vetting state.
   */
  it.each(['manual', 'imported', 'imported_url', 'extracted', 'community'] as const)(
    'vetting after restore == vetting after an edit, source=%s',
    async (source) => {
      const app = await makeApp();
      async function vettedSkill(name: string) {
        const [row] = await pg.handle.db
          .insert(t.skills)
          .values({
            workspaceId,
            name,
            description: '',
            type: 'rubric',
            source,
            body: 'Original body.',
            enabled: false,
            needsVetting: false,
            vettedBodyHash: sql`encode(sha256(convert_to('Original body.', 'UTF8')), 'hex')`,
          })
          .returning();
        await pg.handle.db.insert(t.skillVersions).values([
          { skillId: row!.id, version: 1, body: 'Target body.', name, description: '', type: 'rubric' },
        ]);
        // Current state is v2 with the original body, so v1 differs in body only.
        await pg.handle.db.update(t.skills).set({ version: 2 }).where(eq(t.skills.id, row!.id));
        await pg.handle.db.insert(t.skillVersions).values({
          skillId: row!.id,
          version: 2,
          body: 'Original body.',
          name,
          description: '',
          type: 'rubric',
        });
        return row!.id;
      }

      const editedId = await vettedSkill(uniqueName(`edit-${source}`));
      const restoredId = await vettedSkill(uniqueName(`restore-${source}`));

      const edited = await put(app, editedId, { body: 'Target body.' });
      expect(edited.statusCode).toBe(200);
      const restored = await app.inject({
        method: 'POST',
        url: `/skills/${restoredId}/versions/1/restore`,
        payload: { expected_version: 2 },
      });
      expect(restored.statusCode).toBe(200);

      const [e] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, editedId));
      const [r] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, restoredId));
      expect({ needsVetting: r!.needsVetting, vetted: r!.vettedBodyHash !== null }).toEqual({
        needsVetting: e!.needsVetting,
        vetted: e!.vettedBodyHash !== null,
      });
      expect(r!.needsVetting).toBe(source === 'imported' || source === 'extracted');

      // A restore never enables: an unvetted result cannot be switched on.
      if (r!.needsVetting) {
        const enable = await put(app, restoredId, { enabled: true });
        expect(enable.statusCode).toBe(409);
        expect(enable.json().error.code).toBe('skill_not_vetted');
      }
      await app.close();
    },
  );

  // ---- migration backfill ---------------------------------------------------

  it('0016 backfill: fills metadata on the current snapshot and adds a missing one; idempotent', async () => {
    const [legacy] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: uniqueName('legacy'),
        description: 'Legacy desc.',
        type: 'convention',
        source: 'manual',
        body: 'Legacy v2 body.',
        version: 2,
      })
      .returning();
    await pg.handle.db.insert(t.skillVersions).values({ skillId: legacy!.id, version: 2, body: 'Legacy v2 body.' });
    const [bare] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: uniqueName('bare'),
        description: '',
        type: 'rubric',
        source: 'manual',
        body: 'Never snapshotted.',
      })
      .returning();

    const file = fileURLToPath(
      new URL('../src/db/migrations/0016_skill_versions_backfill.sql', import.meta.url),
    );
    const statements = readFileSync(file, 'utf8').split('--> statement-breakpoint');
    for (let i = 0; i < 2; i++) {
      for (const stmt of statements) await pg.handle.db.execute(sql.raw(stmt));
    }

    expect(await snapshots(legacy!.id)).toEqual([
      expect.objectContaining({ version: 2, name: legacy!.name, description: 'Legacy desc.', type: 'convention' }),
    ]);
    expect(await snapshots(bare!.id)).toEqual([
      expect.objectContaining({ version: 1, name: bare!.name, body: 'Never snapshotted.' }),
    ]);
  });

  it('seeded skills carry a v1 snapshot', async () => {
    const [seeded] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.name, 'branch-coverage-gate'));
    expect(seeded).toBeDefined();
    expect((await snapshots(seeded!.id)).map((s) => s.version)).toEqual([1]);
  });
});
