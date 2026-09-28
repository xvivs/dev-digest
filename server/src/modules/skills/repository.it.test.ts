/**
 * Repository contract test — real Postgres via testcontainers. Proves the SQL:
 * tenancy scoping, the unique-name constraint mapped to a domain error, the
 * atomic version bump + skill_versions snapshot, cascade delete, and the
 * cross-cutting `resolveEffectiveSkills` read used by reviews/run-executor.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import * as t from '../../db/schema.js';
import { SkillsRepository } from './repository.js';
import { SkillNameTakenError } from './domain.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('SkillsRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let wsA: string;
  let wsB: string;
  let repo: SkillsRepository;

  beforeAll(async () => {
    pg = await startPg();
    const [a] = await pg.handle.db.insert(t.workspaces).values({ name: 'ws-a' }).returning();
    const [b] = await pg.handle.db.insert(t.workspaces).values({ name: 'ws-b' }).returning();
    wsA = a!.id;
    wsB = b!.id;
    repo = new SkillsRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function newSkill(overrides: Partial<Parameters<SkillsRepository['insert']>[0]> = {}) {
    return {
      workspaceId: wsA,
      name: 'branch-coverage-gate',
      description: 'Flag untested branches.',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: 'Check every new conditional has a test.',
      enabled: true,
      needsVetting: false,
      ...overrides,
    };
  }

  it('CRUD happy path', async () => {
    const created = await repo.insert(newSkill({ name: `crud-${Date.now()}` }));
    expect(created.id).toBeTruthy();
    expect(created.version).toBe(1);

    const found = await repo.findById(wsA, created.id);
    expect(found?.name).toBe(created.name);

    const ok = await repo.deleteById(wsA, created.id);
    expect(ok).toBe(true);
    expect(await repo.findById(wsA, created.id)).toBeUndefined();
  });

  it('a skill in another workspace is invisible (404 at the service/route)', async () => {
    const created = await repo.insert(newSkill({ name: `tenancy-${Date.now()}` }));
    expect(await repo.findById(wsB, created.id)).toBeUndefined();
  });

  it('duplicate name in the same workspace → SkillNameTakenError (unique violation caught)', async () => {
    const name = `dup-${Date.now()}`;
    await repo.insert(newSkill({ name }));
    await expect(repo.insert(newSkill({ name }))).rejects.toBeInstanceOf(SkillNameTakenError);
  });

  it('the same name is fine in a DIFFERENT workspace', async () => {
    const name = `cross-ws-${Date.now()}`;
    await repo.insert(newSkill({ name, workspaceId: wsA }));
    await expect(repo.insert(newSkill({ name, workspaceId: wsB }))).resolves.toMatchObject({ name });
  });

  it('renaming to a name already taken in the workspace also throws SkillNameTakenError', async () => {
    const takenName = `taken-${Date.now()}`;
    await repo.insert(newSkill({ name: takenName }));
    const other = await repo.insert(newSkill({ name: `other-${Date.now()}` }));
    await expect(
      repo.update(wsA, other.id, {
        name: takenName,
        needsVetting: false,
        vettedBodyHash: null,
        bumpVersion: false,
      }),
    ).rejects.toBeInstanceOf(SkillNameTakenError);
  });

  it('update: version bump + skill_versions row are atomic and happen ONLY when body changes', async () => {
    const created = await repo.insert(newSkill({ name: `version-${Date.now()}` }));

    const renamed = await repo.update(wsA, created.id, {
      name: `renamed-${Date.now()}`,
      needsVetting: false,
      vettedBodyHash: null,
      bumpVersion: false,
    });
    expect(renamed?.version).toBe(1);
    expect(
      await pg.handle.db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, created.id)),
    ).toHaveLength(0);

    const edited = await repo.update(wsA, created.id, {
      body: 'A new body for version 2.',
      needsVetting: false,
      vettedBodyHash: null,
      bumpVersion: true,
    });
    expect(edited?.version).toBe(2);
    const versions = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, created.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(2);
    expect(versions[0]?.body).toBe('A new body for version 2.');
  });

  it('vet: sets vetted_body_hash = sha256(body) and clears needs_vetting', async () => {
    const created = await repo.insert(
      newSkill({ name: `vet-${Date.now()}`, source: 'imported', enabled: false, needsVetting: true }),
    );
    expect(created.vettedBodyHash).toBeNull();
    const vetted = await repo.vet(wsA, created.id);
    expect(vetted?.needsVetting).toBe(false);
    expect(vetted?.vettedBodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('delete cascades: agent_skills links are removed with the skill', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: wsA,
        name: `cascade-agent-${Date.now()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();
    const created = await repo.insert(newSkill({ name: `cascade-${Date.now()}` }));
    await pg.handle.db.insert(t.agentSkills).values({ agentId: agent!.id, skillId: created.id, order: 0 });

    expect(
      await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.skillId, created.id)),
    ).toHaveLength(1);

    await repo.deleteById(wsA, created.id);

    expect(
      await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.skillId, created.id)),
    ).toHaveLength(0);
  });

  it('list: agent_count is a single-query aggregate; q filters name/description', async () => {
    const tag = Date.now();
    const linked = await repo.insert(
      newSkill({ name: `listed-${tag}`, description: 'unique-description-marker' }),
    );
    await repo.insert(newSkill({ name: `unlisted-${tag}` }));
    const [agent1] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: wsA, name: `a1-${tag}`, provider: 'openai', model: 'm', systemPrompt: 'x' })
      .returning();
    const [agent2] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: wsA, name: `a2-${tag}`, provider: 'openai', model: 'm', systemPrompt: 'x' })
      .returning();
    await pg.handle.db
      .insert(t.agentSkills)
      .values([
        { agentId: agent1!.id, skillId: linked.id, order: 0 },
        { agentId: agent2!.id, skillId: linked.id, order: 0, enabled: false },
      ]);

    const all = await repo.list(wsA);
    const row = all.find((r) => r.id === linked.id);
    expect(row?.agentCount).toBe(2); // both links count, regardless of the link's own enabled state

    const filtered = await repo.list(wsA, 'unique-description-marker');
    expect(filtered.map((r) => r.id)).toEqual([linked.id]);
  });

  it('resolveEffectiveSkills: only link.enabled && skill.enabled && !needs_vetting skills are effective, ordered', async () => {
    const tag = Date.now();
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: wsA, name: `resolve-${tag}`, provider: 'openai', model: 'm', systemPrompt: 'x' })
      .returning();

    const effective2nd = await repo.insert(newSkill({ name: `effective-2-${tag}` }));
    const effective1st = await repo.insert(newSkill({ name: `effective-1-${tag}` }));
    const disabledLink = await repo.insert(newSkill({ name: `disabled-link-${tag}` }));
    const disabledSkill = await repo.insert(newSkill({ name: `disabled-skill-${tag}`, enabled: false }));
    const unvetted = await repo.insert(
      newSkill({ name: `unvetted-${tag}`, source: 'imported', enabled: false, needsVetting: true }),
    );

    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: agent!.id, skillId: effective1st.id, order: 0 },
      { agentId: agent!.id, skillId: effective2nd.id, order: 1 },
      { agentId: agent!.id, skillId: disabledLink.id, order: 2, enabled: false },
      { agentId: agent!.id, skillId: disabledSkill.id, order: 3 },
      { agentId: agent!.id, skillId: unvetted.id, order: 4 },
    ]);

    const resolved = await repo.resolveEffectiveSkills([agent!.id]);
    const list = resolved.get(agent!.id) ?? [];
    expect(list.map((s) => s.name)).toEqual([effective1st.name, effective2nd.name]);
    expect(list[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resolveEffectiveSkills: an agent with no effective skill is absent from the map', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: wsA,
        name: `empty-${Date.now()}`,
        provider: 'openai',
        model: 'm',
        systemPrompt: 'x',
      })
      .returning();
    const resolved = await repo.resolveEffectiveSkills([agent!.id]);
    expect(resolved.has(agent!.id)).toBe(false);
  });
});
