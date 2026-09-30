/**
 * Row -> domain mapping for Smart Diff (AC-8, D6): an accepted finding stays
 * active, a dismissed one carries its timestamp, and the whole chain row ->
 * buildSmartDiff -> contract holds.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiffResponse } from '@devdigest/shared/contracts/review-api';
import { toSmartDiffFile, toSmartDiffReview } from '../src/modules/reviews/helpers.js';
import { buildSmartDiff } from '../src/modules/reviews/domain.js';
import type { FindingRow, PrFileRow, ReviewRow } from '../src/modules/reviews/repository.js';

const at = (iso: string) => new Date(iso);
const reviewRow = (agentId: string | null, created: string) =>
  ({ agentId, createdAt: at(created) }) as unknown as ReviewRow;
const findingRow = (file: string, startLine: number, over: Partial<FindingRow> = {}) =>
  ({ file, startLine, dismissedAt: null, acceptedAt: null, ...over }) as unknown as FindingRow;

describe('smart-diff row mapping', () => {
  it('maps a pr_files row to the plain file shape', () => {
    const row = { id: 'x', prId: 'p', path: 'a.ts', additions: 4, deletions: 2, patch: 'zzz' } as unknown as PrFileRow;
    expect(toSmartDiffFile(row)).toEqual({ path: 'a.ts', additions: 4, deletions: 2 });
  });

  it('dismissedAt Date -> ISO string, null stays null', () => {
    const out = toSmartDiffReview({
      review: reviewRow('A', '2026-01-02T03:04:05.000Z'),
      findings: [findingRow('a.ts', 1, { dismissedAt: at('2026-01-05T00:00:00.000Z') }), findingRow('a.ts', 2)],
    });
    expect(out.agent_id).toBe('A');
    expect(out.created_at).toBe('2026-01-02T03:04:05.000Z');
    expect(out.findings.map((f) => f.dismissed_at)).toEqual(['2026-01-05T00:00:00.000Z', null]);
  });

  it('accepted finding still counts, dismissed does not, unknown file is ignored', () => {
    const review = toSmartDiffReview({
      review: reviewRow('A', '2026-01-02T00:00:00.000Z'),
      findings: [
        findingRow('src/a.ts', 8, { acceptedAt: at('2026-01-03T00:00:00.000Z') }),
        findingRow('src/a.ts', 3, { dismissedAt: at('2026-01-03T00:00:00.000Z') }),
        findingRow('gone.ts', 1),
      ],
    });
    const out = buildSmartDiff([{ path: 'src/a.ts', additions: 1, deletions: 1 }], [review]);
    expect(out.groups[0]!.files[0]!.finding_lines).toEqual([8]);
    expect(SmartDiffResponse.safeParse(out).success).toBe(true);
  });
});
