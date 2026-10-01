import { describe, expect, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { resolveAgent, resolvePr, resolveRepo } from '../src/resolve.js';
import { FakeApi } from './fake-api.js';
import { AGENT_ID, PR_ID, REPO_ID } from './fixtures.js';

async function toolError(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError);
    return e as ToolError;
  }
  throw new Error('expected a ToolError');
}

describe('resolveRepo (AC-5)', () => {
  it('matches full_name case-insensitively', async () => {
    const api = new FakeApi();
    await expect(resolveRepo(api, 'ACME/Shop')).resolves.toEqual({ id: REPO_ID, full_name: 'acme/shop' });
  });

  it('gives repo_not_found and calls no PR endpoint', async () => {
    const api = new FakeApi();
    const e = await toolError(resolveRepo(api, 'acme/other'));
    expect(e.kind).toBe('repo_not_found');
    expect(api.callsTo('listPulls')).toHaveLength(0);
  });

  it('gives ambiguous_repo listing the ids', async () => {
    const api = new FakeApi();
    api.repos = [
      { id: 'r1', full_name: 'acme/shop' },
      { id: 'r2', full_name: 'Acme/Shop' },
    ];
    const e = await toolError(resolveRepo(api, 'acme/shop'));
    expect(e.kind).toBe('ambiguous_repo');
    expect(e.message).toContain('r1');
    expect(e.message).toContain('r2');
  });
});

describe('resolvePr (AC-6, DoD-4)', () => {
  const repo = { id: REPO_ID, full_name: 'owner/name' };

  function expectSyncHint(e: ToolError) {
    expect(e.kind).toBe('pr_not_found');
    expect(e.nextStep).toContain('gh pr list --repo owner/name');
    expect(e.nextStep).toContain('GitHub token');
    expect(e.nextStep).toContain('GitHub is reachable');
    expect(e.nextStep).toContain('50 most recently updated');
    expect(e.nextStep.toLowerCase()).not.toContain('open the repo');
  }

  it('finds the PR by number', async () => {
    const api = new FakeApi();
    await expect(resolvePr(api, repo, 3)).resolves.toEqual({ id: PR_ID, number: 3 });
  });

  it('gives pr_not_found with the gh command and sync reasons for a missing PR', async () => {
    const api = new FakeApi();
    expectSyncHint(await toolError(resolvePr(api, repo, 99)));
  });

  it('treats a PR whose id is null as not found', async () => {
    const api = new FakeApi();
    api.pulls = [{ id: null, number: 3 }];
    expectSyncHint(await toolError(resolvePr(api, repo, 3)));
  });
});

describe('resolveAgent (AC-7, AC-8, DoD-4)', () => {
  function agents(api: FakeApi) {
    api.agents = [
      { id: AGENT_ID, name: 'Security Reviewer', description: '', model: 'm', enabled: true },
      { id: 'a2', name: 'Perf Reviewer', description: '', model: 'm', enabled: true },
      { id: 'a3', name: 'Old Agent', description: '', model: 'm', enabled: false },
    ];
    return api;
  }

  it('matches by id', async () => {
    const api = agents(new FakeApi());
    await expect(resolveAgent(api, 'a2')).resolves.toMatchObject({ name: 'Perf Reviewer' });
  });

  it('matches by mixed-case name', async () => {
    const api = agents(new FakeApi());
    await expect(resolveAgent(api, 'security REVIEWER')).resolves.toMatchObject({ id: AGENT_ID });
  });

  it('prefers an id over another agent with that name', async () => {
    const api = new FakeApi();
    api.agents = [
      { id: 'x1', name: 'a2', description: '', model: 'm', enabled: true },
      { id: 'a2', name: 'Real', description: '', model: 'm', enabled: true },
    ];
    await expect(resolveAgent(api, 'a2')).resolves.toMatchObject({ name: 'Real' });
  });

  it('lists every agent name for an unknown agent', async () => {
    const api = agents(new FakeApi());
    const e = await toolError(resolveAgent(api, 'nobody'));
    expect(e.kind).toBe('agent_not_found');
    for (const name of ['Security Reviewer', 'Perf Reviewer', 'Old Agent']) expect(e.message).toContain(name);
    expect(e.nextStep).toBe('Pass one of these names or ids.');
  });

  it('gives ambiguous_agent for names that differ only in case', async () => {
    const api = new FakeApi();
    api.agents = [
      { id: 'x1', name: 'Reviewer', description: '', model: 'm', enabled: true },
      { id: 'x2', name: 'reviewer', description: '', model: 'm', enabled: true },
    ];
    const e = await toolError(resolveAgent(api, 'REVIEWER'));
    expect(e.kind).toBe('ambiguous_agent');
    expect(e.message).toContain('x1');
    expect(e.message).toContain('x2');
  });

  it('gives agent_disabled for a disabled agent', async () => {
    const api = agents(new FakeApi());
    const e = await toolError(resolveAgent(api, 'old agent'));
    expect(e.kind).toBe('agent_disabled');
  });
});
