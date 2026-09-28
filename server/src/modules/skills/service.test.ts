/**
 * Hermetic unit test for the application ring (no Docker — NOT *.it.test.ts).
 * The Drizzle implementation gets its own `repository.it.test.ts`.
 *
 * The fake replicates just enough of the real repository's persistence rules
 * (unique name per workspace, version bump only when body changes) that these
 * tests prove the SERVICE's ADR-0012 decisions (import policy, vetting reset,
 * the enable gate) rather than re-testing SQL.
 */
import { describe, it, expect } from 'vitest';
import { SkillsService } from './service.js';
import {
  SkillNameTakenError,
  SkillNotVettedError,
  type NewSkill,
  type Skill,
} from './domain.js';
import type { SkillStore, SkillWritePatch } from './ports.js';

class InMemorySkillStore implements SkillStore {
  rows: Skill[] = [];
  versions: { skillId: string; version: number; body: string }[] = [];
  private seq = 0;

  async list(workspaceId: string) {
    return this.rows
      .filter((r) => r.workspaceId === workspaceId)
      .map((r) => ({ ...r, agentCount: 0 }));
  }

  async findById(workspaceId: string, id: string) {
    return this.rows.find((r) => r.workspaceId === workspaceId && r.id === id);
  }

  private assertNameFree(workspaceId: string, name: string, excludeId?: string) {
    const clash = this.rows.find(
      (r) => r.workspaceId === workspaceId && r.name === name && r.id !== excludeId,
    );
    if (clash) throw new SkillNameTakenError(name);
  }

  async insert(input: NewSkill): Promise<Skill> {
    this.assertNameFree(input.workspaceId, input.name);
    const now = new Date(0);
    const row: Skill = {
      id: `skill-${++this.seq}`,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
      version: 1,
      evidenceFiles: null,
      needsVetting: input.needsVetting,
      vettedBodyHash: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async update(workspaceId: string, id: string, patch: SkillWritePatch): Promise<Skill | undefined> {
    const row = this.rows.find((r) => r.workspaceId === workspaceId && r.id === id);
    if (!row) return undefined;
    if (patch.name !== undefined) this.assertNameFree(workspaceId, patch.name, id);

    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.type !== undefined) row.type = patch.type;
    if (patch.body !== undefined) row.body = patch.body;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    row.needsVetting = patch.needsVetting;
    row.vettedBodyHash = patch.vettedBodyHash;
    row.updatedAt = new Date(1);
    if (patch.bumpVersion) {
      row.version += 1;
      this.versions.push({ skillId: row.id, version: row.version, body: row.body });
    }
    return row;
  }

  async vet(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const row = this.rows.find((r) => r.workspaceId === workspaceId && r.id === id);
    if (!row) return undefined;
    if (row.version !== version) throw new Error(`stale vet: ${version} != ${row.version}`);
    row.vettedBodyHash = `sha256(${row.body})`;
    row.needsVetting = false;
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.workspaceId === workspaceId && r.id === id));
    return this.rows.length < before;
  }

  transaction<T>(work: (store: SkillStore) => Promise<T>): Promise<T> {
    return work(this); // no real tx/savepoint — just runs on itself, per the template
  }
}

const WS = 'ws-a';

function manualInput(overrides: Partial<Parameters<SkillsService['create']>[1]> = {}) {
  return {
    name: 'branch-coverage-gate',
    description: 'Flag untested branches.',
    type: 'rubric' as const,
    body: 'Check every new conditional has a test.',
    source: 'manual' as const,
    ...overrides,
  };
}

describe('SkillsService — create (ADR 0012 import policy)', () => {
  it('a manual skill is trusted on save: enabled, not needing vetting', async () => {
    const service = new SkillsService(new InMemorySkillStore());
    const skill = await service.create(WS, manualInput());
    expect(skill.enabled).toBe(true);
    expect(skill.needsVetting).toBe(false);
    expect(skill.source).toBe('manual');
  });

  it('an imported skill is FORCED disabled + needs_vetting, regardless of anything else in the input', async () => {
    const service = new SkillsService(new InMemorySkillStore());
    const skill = await service.create(WS, manualInput({ source: 'imported', name: 'api-breaking-change' }));
    expect(skill.enabled).toBe(false);
    expect(skill.needsVetting).toBe(true);
  });

  it('defaults a missing description to empty (skills.description is NOT NULL)', async () => {
    const service = new SkillsService(new InMemorySkillStore());
    const { description, ...rest } = manualInput();
    void description;
    const skill = await service.create(WS, rest);
    expect(skill.description).toBe('');
  });

  it('rejects a duplicate name in the same workspace', async () => {
    const service = new SkillsService(new InMemorySkillStore());
    await service.create(WS, manualInput());
    await expect(service.create(WS, manualInput())).rejects.toBeInstanceOf(SkillNameTakenError);
  });

  it('allows the same name in a different workspace', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    await service.create('ws-a', manualInput());
    await expect(service.create('ws-b', manualInput())).resolves.toMatchObject({ name: 'branch-coverage-gate' });
  });
});

describe('SkillsService — update (ADR 0012 vetting gate)', () => {
  it('bumps version + writes a skill_versions snapshot only when body changes', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput());

    const renamed = await service.update(WS, created.id, { name: 'renamed-skill' });
    expect(renamed?.version).toBe(1); // name-only change: no bump
    expect(store.versions).toHaveLength(0);

    const edited = await service.update(WS, created.id, { body: 'A different rubric body.' });
    expect(edited?.version).toBe(2);
    expect(store.versions).toEqual([{ skillId: created.id, version: 2, body: 'A different rubric body.' }]);
  });

  it('editing the body of an IMPORTED skill resets needs_vetting + clears vetted_body_hash', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source: 'imported' }));
    await service.vet(WS, created.id, created.version);
    const vetted = await service.get(WS, created.id);
    expect(vetted?.needsVetting).toBe(false);
    expect(vetted?.vettedBodyHash).not.toBeNull();

    const edited = await service.update(WS, created.id, { body: 'A tampered-looking new body.' });
    expect(edited?.needsVetting).toBe(true);
    expect(edited?.vettedBodyHash).toBeNull();
  });

  it('a body edit that does NOT change the body does not reset an already-vetted imported skill', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source: 'imported' }));
    await service.vet(WS, created.id, created.version);
    const same = await service.update(WS, created.id, { body: created.body, description: 'tweak' });
    expect(same?.needsVetting).toBe(false);
  });

  it('refuses to enable a skill that still needs vetting (409-mapped SkillNotVettedError)', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source: 'imported' }));
    await expect(service.update(WS, created.id, { enabled: true })).rejects.toBeInstanceOf(
      SkillNotVettedError,
    );
  });

  it('vet then enable: allowed once vetted', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source: 'imported' }));
    await service.vet(WS, created.id, created.version);
    const enabled = await service.update(WS, created.id, { enabled: true });
    expect(enabled?.enabled).toBe(true);
  });

  it('a same-request body edit on an imported skill still refuses enabled:true (needs_vetting forced by THIS patch)', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source: 'imported' }));
    await service.vet(WS, created.id, created.version); // vetted against the ORIGINAL body
    await expect(
      service.update(WS, created.id, { body: 'edited after vetting', enabled: true }),
    ).rejects.toBeInstanceOf(SkillNotVettedError);
  });

  it('returns undefined for a skill in another workspace (route maps this to 404)', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create('ws-a', manualInput());
    expect(await service.get('ws-b', created.id)).toBeUndefined();
    expect(await service.update('ws-b', created.id, { enabled: false })).toBeUndefined();
  });
});

describe('SkillsService — delete', () => {
  it('deletes a skill; a second delete is a no-op (false)', async () => {
    const service = new SkillsService(new InMemorySkillStore());
    const created = await service.create(WS, manualInput());
    expect(await service.delete(WS, created.id)).toBe(true);
    expect(await service.delete(WS, created.id)).toBe(false);
  });
});
