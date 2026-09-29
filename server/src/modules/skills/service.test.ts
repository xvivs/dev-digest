/**
 * Hermetic unit test for the application ring (no Docker — NOT *.it.test.ts).
 * The Drizzle implementation gets its own `repository.it.test.ts`.
 *
 * The fake replicates just enough of the real repository's persistence rules
 * (unique name per workspace, all-field snapshots, the version-guarded
 * restore) that these
 * tests prove the SERVICE's ADR-0012 decisions (import policy, vetting reset,
 * the enable gate) rather than re-testing SQL.
 */
import { describe, it, expect } from 'vitest';
import { SkillStatsService, SkillsService } from './service.js';
import {
  SkillNameTakenError,
  SkillNotVettedError,
  SkillVersionNotFoundError,
  SkillVersionStaleError,
  type NewSkill,
  type Skill,
  type SkillVersionSnapshot,
} from './domain.js';
import { ValidationError } from '../../platform/errors.js';
import type { SkillImpactReader, SkillStatsReader, SkillStore, SkillWritePatch } from './ports.js';
import type { EvalSuiteView } from '../_shared/eval-suite.js';

class InMemorySkillStore implements SkillStore {
  rows: Skill[] = [];
  versions: SkillVersionSnapshot[] = [];
  private seq = 0;

  async list(workspaceId: string) {
    return this.rows
      .filter((r) => r.workspaceId === workspaceId)
      .map((r) => ({ ...r, agentCount: 0, runs30d: 0, latestVerdict: null }));
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
    this.snapshot(row, null);
    return row;
  }

  private snapshot(row: Skill, changeNote: string | null) {
    this.versions.push({
      skillId: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      type: row.type,
      body: row.body,
      changeNote,
      createdAt: row.updatedAt,
    });
  }

  async restore(workspaceId: string, id: string, expectedVersion: number, patch: SkillWritePatch) {
    const row = this.rows.find((r) => r.workspaceId === workspaceId && r.id === id);
    if (!row) return undefined;
    if (row.version !== expectedVersion) throw new SkillVersionStaleError(expectedVersion, row.version);
    return this.update(workspaceId, id, { ...patch, bumpVersion: true });
  }

  async listVersions(skillId: string) {
    return this.versions
      .filter((v) => v.skillId === skillId)
      .sort((a, b) => b.version - a.version)
      .map(({ body, ...summary }) => (void body, summary));
  }

  async findVersion(skillId: string, version: number) {
    return this.versions.find((v) => v.skillId === skillId && v.version === version);
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
      this.snapshot(row, patch.changeNote ?? null);
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
  it('ADR 0016: bumps + snapshots on a name/description/type/body change, never on enabled alone', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput());
    expect(store.versions.map((v) => v.version)).toEqual([1]); // v1 on insert

    expect((await service.update(WS, created.id, { enabled: false }))?.version).toBe(1);
    expect((await service.update(WS, created.id, { name: created.name }))?.version).toBe(1); // unchanged value
    expect((await service.update(WS, created.id, { name: 'renamed-skill' }))?.version).toBe(2);
    expect((await service.update(WS, created.id, { description: 'New text.' }))?.version).toBe(3);
    expect((await service.update(WS, created.id, { type: 'security' }))?.version).toBe(4);
    const edited = await service.update(WS, created.id, {
      body: 'A different rubric body.',
      changeNote: '  tightened wording  ',
    });
    expect(edited?.version).toBe(5);
    expect(store.versions.at(-1)).toMatchObject({
      version: 5,
      name: 'renamed-skill',
      description: 'New text.',
      type: 'security',
      body: 'A different rubric body.',
      changeNote: 'tightened wording',
    });
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

describe('SkillsService — versions + restore (ADR 0016)', () => {
  async function withHistory(source: 'manual' | 'imported' = 'manual') {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source }));
    if (source === 'imported') await service.vet(WS, created.id, 1);
    await service.update(WS, created.id, { name: 'renamed-skill', body: 'Body two.' });
    return { store, service, id: created.id };
  }

  it('lists versions newest first without bodies; undefined for another workspace', async () => {
    const { service, id } = await withHistory();
    const versions = await service.listVersions(WS, id);
    expect(versions?.map((v) => v.version)).toEqual([2, 1]);
    expect(versions?.[0]).not.toHaveProperty('body');
    expect(await service.listVersions('ws-other', id)).toBeUndefined();
    expect(await service.getVersion('ws-other', id, 1)).toBeUndefined();
  });

  it('restore appends v(N+1) with every field of vN and "Restored from vN"', async () => {
    const { store, service, id } = await withHistory();
    const result = await service.restore(WS, id, 1, 2);
    expect(result?.restored).toBe(true);
    expect(result?.skill).toMatchObject({ version: 3, name: 'branch-coverage-gate', body: manualInput().body });
    expect(store.versions.at(-1)).toMatchObject({ version: 3, changeNote: 'Restored from v1' });
    expect(store.versions.map((v) => v.version)).toEqual([1, 2, 3]); // nothing rewritten
  });

  it('restore of a snapshot equal to the current state is a no-op, but still checks expected_version', async () => {
    const { store, service, id } = await withHistory();
    const noop = await service.restore(WS, id, 2, 2);
    expect(noop).toMatchObject({ restored: false, skill: { version: 2 } });
    expect(store.versions).toHaveLength(2);
    await expect(service.restore(WS, id, 2, 1)).rejects.toBeInstanceOf(SkillVersionStaleError);
  });

  it('restore: stale expected_version → SkillVersionStaleError; unknown version → not found', async () => {
    const { service, id } = await withHistory();
    await expect(service.restore(WS, id, 1, 1)).rejects.toBeInstanceOf(SkillVersionStaleError);
    await expect(service.restore(WS, id, 9, 2)).rejects.toBeInstanceOf(SkillVersionNotFoundError);
    expect(await service.restore('ws-other', id, 1, 2)).toBeUndefined();
  });

  it('restore of a legacy snapshot (null metadata) restores the body only', async () => {
    const { store, service, id } = await withHistory();
    const v1 = store.versions.find((v) => v.version === 1)!;
    Object.assign(v1, { name: null, description: null, type: null });
    const result = await service.restore(WS, id, 1, 2);
    expect(result?.skill).toMatchObject({ name: 'renamed-skill', body: manualInput().body, version: 3 });
  });

  it('restore re-checks today\'s input limits on the snapshot (422)', async () => {
    const { store, service, id } = await withHistory();
    store.versions.find((v) => v.version === 1)!.body = 'smuggled\u200Bchar';
    await expect(service.restore(WS, id, 1, 2)).rejects.toBeInstanceOf(ValidationError);
  });

  it('vetting on restore follows the edit rule: only an imported skill is reset', async () => {
    const imported = await withHistory('imported');
    // body changed on PUT → imported skill needs vetting again; vet v2 first
    await imported.service.vet(WS, imported.id, 2);
    const restoredImported = await imported.service.restore(WS, imported.id, 1, 2);
    expect(restoredImported?.skill).toMatchObject({ needsVetting: true, vettedBodyHash: null });

    const manual = await withHistory('manual');
    const restoredManual = await manual.service.restore(WS, manual.id, 1, 2);
    expect(restoredManual?.skill).toMatchObject({ needsVetting: false });
  });

  it('a metadata-only restore of an imported skill keeps its vetting', async () => {
    const store = new InMemorySkillStore();
    const service = new SkillsService(store);
    const created = await service.create(WS, manualInput({ source: 'imported' }));
    await service.update(WS, created.id, { name: 'renamed-skill' }); // v2, same body
    await service.vet(WS, created.id, 2);
    const result = await service.restore(WS, created.id, 1, 2);
    expect(result?.skill).toMatchObject({ version: 3, name: 'branch-coverage-gate', needsVetting: false });
  });
});

describe('SkillStatsService (plan Phase 2)', () => {
  const skill: Skill = {
    id: 's1',
    workspaceId: 'ws',
    name: 'stats-skill',
    description: '',
    type: 'rubric',
    source: 'manual',
    body: 'b',
    enabled: true,
    version: 2,
    evidenceFiles: null,
    needsVetting: false,
    vettedBodyHash: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  const noImpact: SkillImpactReader = { findImpactSuite: async () => undefined };

  function readerWith(calls: number[]): SkillStatsReader {
    return {
      findById: async (ws, id) => (ws === 'ws' && id === 's1' ? skill : undefined),
      listLinkedAgents: async () => [{ agentId: 'a1', agentName: 'alpha', status: 'effective' }],
      runAggregates: async (_ws, _id, days) => {
        calls.push(days);
        return [{ agentId: 'a1', version: 2, model: 'm', runs: 4, tokens: 40 }];
      },
    };
  }

  it('maps the window to days and summarizes the reads', async () => {
    const days: number[] = [];
    const service = new SkillStatsService(readerWith(days), () => 0.5, noImpact);
    for (const w of ['7d', '30d', '90d'] as const) {
      const s = await service.stats('ws', 's1', w);
      expect(s).toMatchObject({ window: w, usage: { runs: 4 }, cost: { costUsd: 0.5, costSource: 'estimated' } });
    }
    expect(days).toEqual([7, 30, 90]);
  });

  it('undefined for a skill outside the workspace, without reading runs', async () => {
    const days: number[] = [];
    const service = new SkillStatsService(readerWith(days), () => 0, noImpact);
    expect(await service.stats('other-ws', 's1', '30d')).toBeUndefined();
    expect(days).toEqual([]);
  });
  const suite = (over: Partial<EvalSuiteView> = {}): EvalSuiteView => ({
    id: 'suite-1',
    workspaceId: 'ws',
    skillId: 's1',
    skillVersion: 2,
    promptSha256: 'p',
    carrierAgentId: 'a1',
    carrierAgentVersion: 1,
    carrierName: 'alpha',
    model: 'm',
    mode: 'full',
    repeats: 3,
    status: 'done',
    totalJobs: 30,
    doneJobs: 30,
    estimateUsd: 0.1,
    costUsd: 0.05,
    costSource: 'estimated',
    stale: true,
    results: { passing: 5, total: 5, caught: 2, regressed: 0, flaky: 0, errored: 0, delta_unexpected: 0, verdict: 'helps' },
    error: null,
    caseIds: null,
    createdAt: new Date(0),
    startedAt: new Date(0),
    finishedAt: new Date(0),
    ...over,
  });

  it('impact: the impact suite verdict and stale flag; unknown while it has not finished', async () => {
    const withSuite = (s: EvalSuiteView): SkillImpactReader => ({
      findImpactSuite: async (ws, id) => (ws === 'ws' && id === 's1' ? s : undefined),
    });
    const done = await new SkillStatsService(readerWith([]), () => 0, withSuite(suite())).stats('ws', 's1', '30d');
    expect(done?.impact).toMatchObject({ verdict: 'helps', stale: true, suite: { id: 'suite-1' } });

    const running = await new SkillStatsService(
      readerWith([]),
      () => 0,
      withSuite(suite({ status: 'running', results: null })),
    ).stats('ws', 's1', '30d');
    expect(running?.impact?.verdict).toBe('unknown');

    const none = await new SkillStatsService(readerWith([]), () => 0, noImpact).stats('ws', 's1', '30d');
    expect(none?.impact).toBeNull();
  });
});
