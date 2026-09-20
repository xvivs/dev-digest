/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  rollupSeverities,
  rollupSeverityRows,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe('rollupSeverityRows', () => {
  it('keeps each review in its own bucket when several arrive in one batch', () => {
    // The list endpoint groups findings for EVERY PR of a repo in one query,
    // so the whole point of this fold is that review A's tally never leaks
    // into review B's.
    const byReview = rollupSeverityRows([
      { reviewId: 'rev-a', severity: 'CRITICAL', n: 1 },
      { reviewId: 'rev-b', severity: 'WARNING', n: 3 },
      { reviewId: 'rev-a', severity: 'WARNING', n: 2 },
      { reviewId: 'rev-a', severity: 'SUGGESTION', n: 1 },
      { reviewId: 'rev-b', severity: 'SUGGESTION', n: 5 },
    ]);

    expect(byReview.get('rev-a')).toEqual({ critical: 1, warning: 2, suggestion: 1 });
    expect(byReview.get('rev-b')).toEqual({ critical: 0, warning: 3, suggestion: 5 });
    expect(byReview.size).toBe(2);
  });

  it('sums repeated rows for the same review+severity pair', () => {
    expect(
      rollupSeverityRows([
        { reviewId: 'rev-a', severity: 'WARNING', n: 2 },
        { reviewId: 'rev-a', severity: 'WARNING', n: 4 },
      ]).get('rev-a'),
    ).toEqual({ critical: 0, warning: 6, suggestion: 0 });
  });

  it('ignores an unknown severity without dropping the review or throwing', () => {
    // `findings.severity` is a plain text column, not a pg enum, so a row the
    // contract does not know about is reachable from the DB.
    const byReview = rollupSeverityRows([
      { reviewId: 'rev-a', severity: 'INFO', n: 7 },
      { reviewId: 'rev-a', severity: 'CRITICAL', n: 1 },
      { reviewId: 'rev-b', severity: 'critical', n: 9 }, // wrong case — also unknown
    ]);

    expect(byReview.get('rev-a')).toEqual({ critical: 1, warning: 0, suggestion: 0 });
    // The review still gets an entry — an all-zero tally, never a missing key.
    expect(byReview.get('rev-b')).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });

  it('returns an empty map for no rows', () => {
    const byReview = rollupSeverityRows([]);
    expect(byReview.size).toBe(0);
    expect(byReview.get('rev-a')).toBeUndefined();
  });
});
