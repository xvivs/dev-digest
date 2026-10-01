/**
 * Spec 06 D7: the pure Prepare plan (AC-3..AC-7, AC-12, AC-12a, AC-13, AC-21).
 */
import { describe, it, expect } from 'vitest';
import type { BriefFailure } from '@devdigest/shared';
import {
  blockedBy,
  buildReadiness,
  classifyBrief,
  classifyIndex,
  planExplicit,
  planPrepare,
  type IndexFacts,
  type PrepareFacts,
} from '../src/modules/overview/domain.js';

const fail = (reason: BriefFailure['reason']): BriefFailure => ({ reason, at: '2026-10-01T00:00:00.000Z' });

type Over = {
  clone?: Partial<PrepareFacts['clone']>;
  index?: Partial<PrepareFacts['index']>;
  brief?: Partial<PrepareFacts['brief']>;
  blocked_by?: PrepareFacts['blocked_by'];
  atCloneHead?: boolean;
};

/** An all-ready PR: cloned, full index at HEAD, fresh brief. */
function facts(o: Over = {}): PrepareFacts {
  return {
    pr_id: 'p1',
    repo_id: 'r1',
    clone: { status: 'cloned', in_flight: false, last_failure: null, ...o.clone },
    index: {
      status: 'full',
      in_flight: false,
      last_indexed_at: null,
      last_indexed_sha: 'h1',
      partial_reason: null,
      ...o.index,
    },
    brief: {
      intent: 'fresh',
      risks: 'fresh',
      in_flight: false,
      intent_failure: null,
      risks_failure: null,
      ...o.brief,
    },
    blocked_by: o.blocked_by ?? null,
    atCloneHead: o.atCloneHead ?? true,
  };
}

describe('classifyIndex (D7 table, first match wins)', () => {
  const base: IndexFacts = {
    enabled: true,
    cloned: true,
    cloneHead: 'h1',
    state: { status: 'full', lastIndexedSha: 'h1' },
    versionCurrent: true,
  };
  it.each([
    ['flag off', { enabled: false, cloned: false }, 'flag_off'],
    ['not cloned', { cloned: false }, 'no_clone'],
    ['cloned, no readable HEAD', { cloneHead: null }, 'no_head'],
    ['no row', { state: null }, 'missing'],
    ['old indexer version', { versionCurrent: false, state: { status: 'degraded', lastIndexedSha: 'h1' } }, 'outdated'],
    ['degraded', { state: { status: 'degraded', lastIndexedSha: 'h1' } }, 'degraded'],
    ['failed', { state: { status: 'failed', lastIndexedSha: 'h1' } }, 'degraded'],
    ['partial at HEAD', { state: { status: 'partial', lastIndexedSha: 'h1' } }, 'partial'],
    ['partial at another sha', { state: { status: 'partial', lastIndexedSha: 'h0' } }, 'partial'],
    ['full at HEAD', {}, 'full'],
    ['full at another sha', { state: { status: 'full', lastIndexedSha: 'h0' } }, 'stale'],
  ] as const)('%s → %s', (_n, over, expected) => {
    expect(classifyIndex({ ...base, ...over } as IndexFacts)).toBe(expected);
  });
});

describe('classifyBrief', () => {
  it('missing / stale / fresh from the facade view', () => {
    expect(classifyBrief({ record: null, stale: false })).toBe('missing');
    expect(classifyBrief({ record: {}, stale: true })).toBe('stale');
    expect(classifyBrief({ record: {}, stale: false })).toBe('fresh');
  });
});

describe('blockedBy', () => {
  it('head_moved wins over provider_not_configured, in either phase', () => {
    expect(blockedBy(fail('provider_not_configured'), fail('head_moved'))).toBe('head_moved');
    expect(blockedBy(fail('head_moved'), null)).toBe('head_moved');
    expect(blockedBy(null, fail('provider_not_configured'))).toBe('provider_not_configured');
    expect(blockedBy(fail('llm_error'), fail('timeout'))).toBeNull();
    expect(blockedBy(null, null)).toBeNull();
  });
});

describe('planPrepare', () => {
  it('all ready → []', () => {
    expect(planPrepare(facts())).toEqual([]);
  });

  it('no clone → clone only, no derive_brief even with a missing intent (PC-2)', () => {
    const f = facts({ clone: { status: 'missing' }, index: { status: 'no_clone' }, brief: { intent: 'missing' } });
    expect(planPrepare(f)).toEqual(['clone']);
  });

  it('cloned without a readable HEAD → clone (PC-6)', () => {
    expect(planPrepare(facts({ index: { status: 'no_head' } }))).toEqual(['clone']);
  });

  it('clone in flight → no clone, no index and no derive', () => {
    const f = facts({ clone: { status: 'missing', in_flight: true }, index: { status: 'no_clone' }, brief: { intent: 'missing' } });
    expect(planPrepare(f)).toEqual([]);
    expect(planPrepare(facts({ clone: { in_flight: true }, index: { status: 'missing' } }))).toEqual([]);
  });

  it.each(['missing', 'outdated', 'degraded'] as const)('%s → index_full', (status) => {
    expect(planPrepare(facts({ index: { status } }))).toEqual(['index_full']);
  });

  it('stale → index_incremental', () => {
    expect(planPrepare(facts({ index: { status: 'stale' } }))).toEqual(['index_incremental']);
  });

  it('partial at HEAD → no index action; partial at another sha → index_full', () => {
    expect(planPrepare(facts({ index: { status: 'partial' }, atCloneHead: true }))).toEqual([]);
    expect(planPrepare(facts({ index: { status: 'partial' }, atCloneHead: false }))).toEqual(['index_full']);
  });

  it('index in flight → no index action', () => {
    expect(planPrepare(facts({ index: { status: 'missing', in_flight: true } }))).toEqual([]);
  });

  it('flag off → no clone/index; a missing intent still derives', () => {
    const f = facts({ clone: { status: 'missing' }, index: { status: 'flag_off' }, brief: { intent: 'missing' } });
    expect(planPrepare(f)).toEqual(['derive_brief']);
    expect(planPrepare(facts({ clone: { status: 'missing' }, index: { status: 'flag_off' } }))).toEqual([]);
  });

  it('head_moved / provider_not_configured block derive_brief', () => {
    expect(planPrepare(facts({ brief: { intent: 'missing', intent_failure: fail('head_moved') }, blocked_by: 'head_moved' }))).toEqual([]);
    expect(
      planPrepare(facts({ brief: { risks: 'missing', risks_failure: fail('provider_not_configured') }, blocked_by: 'provider_not_configured' })),
    ).toEqual([]);
  });

  it('a non-blocking failure (llm_error) with fresh rows → derive_brief', () => {
    expect(planPrepare(facts({ brief: { risks_failure: fail('llm_error') } }))).toEqual(['derive_brief']);
  });

  it('stale risks → derive_brief; brief in flight → none', () => {
    expect(planPrepare(facts({ brief: { risks: 'stale' } }))).toEqual(['derive_brief']);
    expect(planPrepare(facts({ brief: { risks: 'stale', in_flight: true } }))).toEqual([]);
  });

  it('stale index + missing intent → both, index first', () => {
    expect(planPrepare(facts({ index: { status: 'stale' }, brief: { intent: 'missing' } }))).toEqual([
      'index_incremental',
      'derive_brief',
    ]);
  });
});

describe('planExplicit', () => {
  it('partial at HEAD → reindex_partial', () => {
    expect(planExplicit(facts({ index: { status: 'partial' }, atCloneHead: true }))).toEqual(['reindex_partial']);
  });
  it('partial at another sha → [] (planPrepare takes it)', () => {
    expect(planExplicit(facts({ index: { status: 'partial' }, atCloneHead: false }))).toEqual([]);
  });
  it('in flight → []', () => {
    expect(planExplicit(facts({ index: { status: 'partial', in_flight: true } }))).toEqual([]);
    expect(planExplicit(facts({ index: { status: 'partial' }, clone: { in_flight: true } }))).toEqual([]);
  });
  it('full → []', () => {
    expect(planExplicit(facts())).toEqual([]);
  });
});

describe('buildReadiness', () => {
  it('adds the plan and the top-level in_flight, and drops the internal flag', () => {
    const r = buildReadiness(facts({ index: { status: 'partial' }, brief: { in_flight: true } }));
    expect(r.actions).toEqual([]);
    expect(r.explicit_actions).toEqual(['reindex_partial']);
    expect(r.in_flight).toBe(true);
    expect('atCloneHead' in r).toBe(false);
  });
});
