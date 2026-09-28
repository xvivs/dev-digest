/**
 * Hermetic unit test for the application ring (no Docker — NOT *.it.test.ts).
 * The Drizzle implementation is covered by `test/agents-skill-links.it.test.ts`.
 *
 * The fake keeps just enough state (agents, workspace skills, links) and a
 * snapshot-on-transaction rollback to prove the SERVICE's SPEC-02 decisions for
 * `setSkillLinks`: the cross-tenant guard, the enabled-skills budget, and that
 * a refused request leaves the existing links untouched.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { AGENT_SKILLS_BODY_BUDGET_BYTES } from './constants.js';
import type { AgentRecord, LinkableSkill, SkillLinkInput } from './domain.js';
import type { AgentStore, LinkedSkill } from './ports.js';
import { AgentsService } from './service.js';

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const AGENT = 'agent-1';

interface StoredSkill extends LinkableSkill {
  workspaceId: string;
}

class InMemoryAgentStore implements AgentStore {
  agents = [{ id: AGENT, workspaceId: WS } as AgentRecord];
  skills: StoredSkill[] = [];
  links: (SkillLinkInput & { agentId: string; order: number })[] = [];
  replaceCalls = 0;

  async getById(workspaceId: string, id: string) {
    return this.agents.find((a) => a.workspaceId === workspaceId && a.id === id);
  }

  async findWorkspaceSkills(workspaceId: string, skillIds: string[]) {
    return this.skills
      .filter((s) => s.workspaceId === workspaceId && skillIds.includes(s.id))
      .map(({ id, enabled, body }) => ({ id, enabled, body }));
  }

  async replaceSkillLinks(agentId: string, links: SkillLinkInput[]) {
    this.replaceCalls++;
    this.links = [
      ...this.links.filter((l) => l.agentId !== agentId),
      ...links.map((l, order) => ({ ...l, agentId, order })),
    ];
  }

  async linkedSkills(agentId: string): Promise<LinkedSkill[]> {
    return this.links
      .filter((l) => l.agentId === agentId)
      .sort((a, b) => a.order - b.order)
      .map((l) => ({ skill: { id: l.skillId }, order: l.order, enabled: l.enabled }));
  }

  /** Rollback = restore the pre-transaction links when `work` throws. */
  async transaction<T>(work: (store: AgentStore) => Promise<T>): Promise<T> {
    const before = this.links.map((l) => ({ ...l }));
    try {
      return await work(this);
    } catch (err) {
      this.links = before;
      throw err;
    }
  }

  // Not exercised by these tests.
  list = unused;
  skillCountFor = unused;
  deleteById = unused;
  insert = unused;
  update = unused;
  listVersions = unused;
  getVersion = unused;
}

function unused(): never {
  throw new Error('not used in this test');
}

function setup() {
  const store = new InMemoryAgentStore();
  const service = new AgentsService(store, {} as unknown as Container);
  return { store, service };
}

function addSkill(store: InMemoryAgentStore, skill: Partial<StoredSkill> & { id: string }) {
  store.skills.push({ workspaceId: WS, enabled: true, body: 'x', ...skill });
}

describe('AgentsService.setSkillLinks', () => {
  it('replaces the link set in request order', async () => {
    const { store, service } = setup();
    addSkill(store, { id: 's1' });
    addSkill(store, { id: 's2' });

    const result = await service.setSkillLinks(WS, AGENT, [
      { skill_id: 's2', enabled: true },
      { skill_id: 's1', enabled: false },
    ]);

    expect(result).toEqual([
      { agent_id: AGENT, skill_id: 's2', order: 0, enabled: true },
      { agent_id: AGENT, skill_id: 's1', order: 1, enabled: false },
    ]);
  });

  it('returns undefined when the agent is not in this workspace, without writing', async () => {
    const { store, service } = setup();
    addSkill(store, { id: 's1', workspaceId: OTHER_WS });

    const result = await service.setSkillLinks(OTHER_WS, AGENT, [{ skill_id: 's1', enabled: true }]);

    expect(result).toBeUndefined();
    expect(store.replaceCalls).toBe(0);
  });

  it('rejects a cross-tenant skill with 404 and keeps the previous links', async () => {
    const { store, service } = setup();
    addSkill(store, { id: 'mine' });
    addSkill(store, { id: 'foreign', workspaceId: OTHER_WS });
    await service.setSkillLinks(WS, AGENT, [{ skill_id: 'mine', enabled: true }]);

    await expect(
      service.setSkillLinks(WS, AGENT, [
        { skill_id: 'mine', enabled: true },
        { skill_id: 'foreign', enabled: true },
      ]),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await store.linkedSkills(AGENT)).toEqual([
      { skill: { id: 'mine' }, order: 0, enabled: true },
    ]);
    expect(store.replaceCalls).toBe(1);
  });

  it('rejects enabled skills over the byte budget with 422 and writes nothing', async () => {
    const { store, service } = setup();
    addSkill(store, { id: 'a', body: 'a'.repeat(AGENT_SKILLS_BODY_BUDGET_BYTES) });
    addSkill(store, { id: 'b', body: 'b' });

    const err = await service
      .setSkillLinks(WS, AGENT, [
        { skill_id: 'a', enabled: true },
        { skill_id: 'b', enabled: true },
      ])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      statusCode: 422,
      code: 'agent_skills_budget_exceeded',
      details: { budget_bytes: AGENT_SKILLS_BODY_BUDGET_BYTES + 1 },
    });
    expect(store.replaceCalls).toBe(0);
  });

  it('counts UTF-8 bytes, not characters, toward the budget', async () => {
    const { store, service } = setup();
    // 'я' is 2 bytes in UTF-8: half the budget in characters is exactly the budget.
    addSkill(store, { id: 'cyr', body: 'я'.repeat(AGENT_SKILLS_BODY_BUDGET_BYTES / 2) });
    addSkill(store, { id: 'one', body: 'x' });

    await expect(
      service.setSkillLinks(WS, AGENT, [{ skill_id: 'cyr', enabled: true }]),
    ).resolves.toHaveLength(1);
    await expect(
      service.setSkillLinks(WS, AGENT, [
        { skill_id: 'cyr', enabled: true },
        { skill_id: 'one', enabled: true },
      ]),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('ignores disabled links and disabled skills when summing the budget', async () => {
    const { store, service } = setup();
    const huge = 'z'.repeat(AGENT_SKILLS_BODY_BUDGET_BYTES + 1);
    addSkill(store, { id: 'off-link', body: huge });
    addSkill(store, { id: 'off-skill', body: huge, enabled: false });

    const result = await service.setSkillLinks(WS, AGENT, [
      { skill_id: 'off-link', enabled: false },
      { skill_id: 'off-skill', enabled: true },
    ]);

    expect(result).toHaveLength(2);
  });
});
