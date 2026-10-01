/**
 * Spec 06: OverviewService over in-memory fakes for its four ports
 * (AC-1, AC-3, AC-8, AC-21, AC-22, D10).
 */
import { describe, it, expect, vi } from 'vitest';
import { PrOverviewReadiness, type BriefFailure } from '@devdigest/shared';
import { OverviewService } from '../src/modules/overview/service.js';
import type { BriefPhase, CloneStatusView, IndexReadinessFacts, OverviewDeps, RequestOutcome } from '../src/modules/overview/ports.js';

interface World {
  cloned: boolean;
  cloneInFlight: boolean;
  cloneFailure: CloneStatusView['lastFailure'];
  index: IndexReadinessFacts;
  intent: BriefPhase;
  risks: BriefPhase;
}

const phase = (over: Partial<BriefPhase> = {}): BriefPhase => ({
  record: {},
  stale: false,
  inFlight: false,
  lastFailure: null,
  ...over,
});

function setup(over: Partial<World> = {}) {
  const world: World = {
    cloned: true,
    cloneInFlight: false,
    cloneFailure: null,
    index: {
      enabled: true,
      cloneHead: 'h1',
      state: { status: 'full', lastIndexedSha: 'h1', lastIndexedAt: new Date('2026-09-30T10:00:00Z'), partialReason: null },
      versionCurrent: true,
      inFlight: false,
    },
    intent: phase(),
    risks: phase(),
    ...over,
  };
  const ok: RequestOutcome = { queued: true };
  const calls = {
    requestClone: vi.fn(async (): Promise<RequestOutcome | undefined> => {
      world.cloneInFlight = true;
      return ok;
    }),
    requestIndex: vi.fn(async (_ws: string, _repo: string, _kind: 'index' | 'refresh'): Promise<RequestOutcome> => {
      world.index = { ...world.index, inFlight: true };
      return ok;
    }),
    requestDerive: vi.fn(async (): Promise<{ queued: boolean } | undefined> => {
      world.intent = { ...world.intent, inFlight: true };
      world.risks = { ...world.risks, inFlight: true };
      return { queued: true };
    }),
  };
  const warn = vi.fn();
  const deps: OverviewDeps = {
    pulls: { getPull: async (ws, id) => (ws === 'w1' && id === 'p1' ? { id: 'p1', repoId: 'r1' } : undefined) },
    clone: {
      getCloneStatus: async () => ({ cloned: world.cloned, inFlight: world.cloneInFlight, lastFailure: world.cloneFailure }),
      requestClone: calls.requestClone,
    },
    index: { getReadiness: async () => world.index, requestIndex: calls.requestIndex },
    brief: {
      getPhases: async () => ({ intent: world.intent, risks: world.risks }),
      requestDerive: calls.requestDerive,
    },
    log: { warn },
  };
  return { svc: new OverviewService(deps), world, calls, warn };
}

const partialAtHead = (): IndexReadinessFacts => ({
  enabled: true,
  cloneHead: 'h1',
  state: { status: 'partial', lastIndexedSha: 'h1', lastIndexedAt: null, partialReason: 'soft_budget' },
  versionCurrent: true,
  inFlight: false,
});

const noRequests = (c: ReturnType<typeof setup>['calls']) => {
  expect(c.requestClone).not.toHaveBeenCalled();
  expect(c.requestIndex).not.toHaveBeenCalled();
  expect(c.requestDerive).not.toHaveBeenCalled();
};

describe('OverviewService.readiness', () => {
  it('maps facts to the contract shape and requests nothing', async () => {
    const s = setup({ intent: phase({ record: null }) });
    const r = await s.svc.readiness('w1', 'p1');
    expect(() => PrOverviewReadiness.parse(r)).not.toThrow();
    expect(r).toMatchObject({
      pr_id: 'p1',
      repo_id: 'r1',
      clone: { status: 'cloned', in_flight: false, last_failure: null },
      index: { status: 'full', last_indexed_at: '2026-09-30T10:00:00.000Z', last_indexed_sha: 'h1', partial_reason: null },
      brief: { intent: 'missing', risks: 'fresh' },
      blocked_by: null,
      actions: ['derive_brief'],
      explicit_actions: [],
      in_flight: false,
    });
    noRequests(s.calls);
  });

  it('an empty sha maps to null; partial_reason is reported for a partial row', async () => {
    const s = setup({
      index: { ...partialAtHead(), state: { status: 'partial', lastIndexedSha: '', lastIndexedAt: null, partialReason: 'no_files' } },
    });
    const r = (await s.svc.readiness('w1', 'p1'))!;
    expect(r.index.last_indexed_sha).toBeNull();
    expect(r.index.partial_reason).toBe('no_files');
  });

  it('keeps the failing phase apart and derives blocked_by', async () => {
    const f: BriefFailure = { reason: 'head_moved', at: 'x' };
    const s = setup({ risks: phase({ lastFailure: f }) });
    const r = (await s.svc.readiness('w1', 'p1'))!;
    expect(r.brief.risks_failure).toEqual(f);
    expect(r.brief.intent_failure).toBeNull();
    expect(r.blocked_by).toBe('head_moved');
    expect(r.actions).toEqual([]);
  });

  it('foreign PR → undefined', async () => {
    const s = setup();
    await expect(s.svc.readiness('w2', 'p1')).resolves.toBeUndefined();
  });
});

describe('OverviewService.prepare', () => {
  it('a ready PR → skipped, no request', async () => {
    const s = setup();
    await expect(s.svc.prepare('w1', 'p1', {})).resolves.toMatchObject({ status: 'skipped', started: [], failed: [] });
    noRequests(s.calls);
  });

  it('calls exactly the planned requests and returns the readiness recomputed after them', async () => {
    const s = setup({
      index: { ...setup().world.index, state: { status: 'full', lastIndexedSha: 'h0', lastIndexedAt: null, partialReason: null } },
      intent: phase({ stale: true }),
    });
    const res = (await s.svc.prepare('w1', 'p1'))!;
    expect(res.status).toBe('started');
    expect(res.started).toEqual(['index_incremental', 'derive_brief']);
    expect(s.calls.requestIndex).toHaveBeenCalledTimes(1);
    expect(s.calls.requestIndex).toHaveBeenCalledWith('w1', 'r1', 'refresh');
    expect(s.calls.requestDerive).toHaveBeenCalledWith('w1', 'p1');
    expect(s.calls.requestClone).not.toHaveBeenCalled();
    expect(res.readiness.in_flight).toBe(true);
    expect(res.readiness.actions).toEqual([]);
  });

  it('no clone → only requestClone', async () => {
    const s = setup({ cloned: false, intent: phase({ record: null }) });
    const res = (await s.svc.prepare('w1', 'p1'))!;
    expect(res.started).toEqual(['clone']);
    expect(s.calls.requestIndex).not.toHaveBeenCalled();
    expect(s.calls.requestDerive).not.toHaveBeenCalled();
  });

  it('partial at HEAD: {} → skipped; { reindex_partial: true } → one full index', async () => {
    const s = setup({ index: partialAtHead() });
    await expect(s.svc.prepare('w1', 'p1', {})).resolves.toMatchObject({ status: 'skipped' });
    expect(s.calls.requestIndex).not.toHaveBeenCalled();

    const res = (await s.svc.prepare('w1', 'p1', { reindex_partial: true }))!;
    expect(res.started).toEqual(['reindex_partial']);
    expect(s.calls.requestIndex).toHaveBeenCalledTimes(1);
    expect(s.calls.requestIndex).toHaveBeenCalledWith('w1', 'r1', 'index');
  });

  it('{ reindex_partial: true } on a full index is ignored', async () => {
    const s = setup();
    await expect(s.svc.prepare('w1', 'p1', { reindex_partial: true })).resolves.toMatchObject({ status: 'skipped', started: [] });
    noRequests(s.calls);
  });

  it('{ reindex_partial: true } with derive_brief planned → both requested (PC-19)', async () => {
    const s = setup({ index: partialAtHead(), intent: phase({ record: null }) });
    const res = (await s.svc.prepare('w1', 'p1', { reindex_partial: true }))!;
    expect(res.started).toEqual(['derive_brief', 'reindex_partial']);
    expect(s.calls.requestIndex).toHaveBeenCalledWith('w1', 'r1', 'index');
    expect(s.calls.requestDerive).toHaveBeenCalledTimes(1);
  });

  it('a rejected or no_handler request lands in failed; an in_flight one in neither', async () => {
    const s = setup({
      index: { ...setup().world.index, state: null },
      intent: phase({ record: null }),
    });
    s.calls.requestIndex.mockResolvedValueOnce({ queued: false, reason: 'no_handler' });
    s.calls.requestDerive.mockRejectedValueOnce(new Error('queue full'));
    const res = (await s.svc.prepare('w1', 'p1'))!;
    expect(res.failed).toEqual(['index_full', 'derive_brief']);
    expect(res.started).toEqual([]);
    expect(res.status).toBe('skipped');
    expect(s.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'derive_brief' }), 'overview: prepare request failed');

    const t = setup({ index: { ...setup().world.index, state: null } });
    t.calls.requestIndex.mockResolvedValueOnce({ queued: false, reason: 'in_flight' });
    const res2 = (await t.svc.prepare('w1', 'p1'))!;
    expect(res2).toMatchObject({ status: 'skipped', started: [], failed: [] });
  });

  it('provider_not_configured on either phase: readiness blocked, prepare never derives', async () => {
    const failure: BriefFailure = { reason: 'provider_not_configured', at: '2026-10-01T00:00:00Z' };
    const s = setup({ intent: phase({ record: null, lastFailure: failure }) });
    const ready = (await s.svc.readiness('w1', 'p1'))!;
    expect(ready.blocked_by).toBe('provider_not_configured');
    expect(ready.actions).not.toContain('derive_brief');
    const res = (await s.svc.prepare('w1', 'p1', {}))!;
    expect(res).toMatchObject({ status: 'skipped', started: [], failed: [] });
    expect(s.calls.requestDerive).not.toHaveBeenCalled();

    const r = setup({ risks: phase({ stale: true, lastFailure: failure }) });
    expect((await r.svc.readiness('w1', 'p1'))!.blocked_by).toBe('provider_not_configured');
    await r.svc.prepare('w1', 'p1', {});
    expect(r.calls.requestDerive).not.toHaveBeenCalled();
  });

  it('a partial index at HEAD is never re-run implicitly, even when other work is planned', async () => {
    const s = setup({ index: partialAtHead(), intent: phase({ record: null }) });
    const res = (await s.svc.prepare('w1', 'p1', {}))!;
    expect(res.started).toEqual(['derive_brief']);
    expect(s.calls.requestIndex).not.toHaveBeenCalled();
    // A second body shape: explicit false is not a request either.
    await s.svc.prepare('w1', 'p1', { reindex_partial: false });
    expect(s.calls.requestIndex).not.toHaveBeenCalled();
  });

  it('no clone after a failed clone job: prepare asks for a clone again but never for index or derive', async () => {
    const s = setup({
      cloned: false,
      cloneInFlight: false,
      index: { ...setup().world.index, cloneHead: null, state: null },
      intent: phase({ record: null }),
    });
    const res = (await s.svc.prepare('w1', 'p1', {}))!;
    expect(res.started).toEqual(['clone']);
    expect(s.calls.requestClone).toHaveBeenCalledTimes(1);
    expect(s.calls.requestIndex).not.toHaveBeenCalled();
    expect(s.calls.requestDerive).not.toHaveBeenCalled();
  });

  it('failed clone: readiness carries last_failure (ISO time), the plan still offers clone, prepare passes it through', async () => {
    const at = new Date('2026-09-30T12:00:00.000Z');
    const s = setup({
      cloned: false,
      cloneFailure: { reason: 'not_found', at },
      index: { ...setup().world.index, cloneHead: null, state: null },
    });
    const r = (await s.svc.readiness('w1', 'p1'))!;
    expect(() => PrOverviewReadiness.parse(r)).not.toThrow();
    expect(r.clone).toEqual({
      status: 'missing',
      in_flight: false,
      last_failure: { reason: 'not_found', at: '2026-09-30T12:00:00.000Z' },
    });
    expect(r.actions).toContain('clone');
    const res = (await s.svc.prepare('w1', 'p1', {}))!;
    expect(res.started).toEqual(['clone']);
    expect(res.readiness.clone.last_failure?.reason).toBe('not_found');
  });

  it('foreign PR → undefined, no request', async () => {
    const s = setup();
    await expect(s.svc.prepare('w2', 'p1', {})).resolves.toBeUndefined();
    noRequests(s.calls);
  });
});
