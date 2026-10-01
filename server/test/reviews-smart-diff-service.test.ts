/** Hermetic: the SmartDiffSource port is an in-memory fake (no DB, LLM or GitHub). */
import { describe, it, expect } from 'vitest';
import { SmartDiffService } from '../src/modules/reviews/smart-diff.service.js';
import type { SmartDiffFileInput, SmartDiffReviewInput } from '../src/modules/reviews/domain.js';
import type { SmartDiffSource } from '../src/modules/reviews/ports.js';

const FILES: SmartDiffFileInput[] = [
  { path: 'src/a.ts', additions: 3, deletions: 1 },
  { path: 'src/a.test.ts', additions: 5, deletions: 0 },
];
const REVIEWS: SmartDiffReviewInput[] = [
  {
    agent_id: 'A',
    created_at: '2026-01-02T00:00:00.000Z',
    findings: [
      { file: 'src/a.ts', start_line: 7, dismissed_at: null },
      { file: 'src/a.ts', start_line: 2, dismissed_at: '2026-01-03T00:00:00.000Z' },
    ],
  },
];

function setup() {
  const calls: string[] = [];
  const source: SmartDiffSource = {
    pullExists: async (ws, id) => {
      calls.push(`exists:${ws}:${id}`);
      return ws === 'ws1' && id === 'pr1';
    },
    getSmartDiffFiles: async (id) => {
      calls.push(`files:${id}`);
      return FILES;
    },
    getSmartDiffReviews: async (id) => {
      calls.push(`reviews:${id}`);
      return REVIEWS;
    },
  };
  return { svc: new SmartDiffService(source), calls };
}

describe('SmartDiffService', () => {
  it('returns undefined for a PR in another workspace and reads nothing else', async () => {
    const { svc, calls } = setup();
    expect(await svc.getForPull('ws2', 'pr1')).toBeUndefined();
    expect(calls).toEqual(['exists:ws2:pr1']);
  });

  it('returns undefined for a missing PR', async () => {
    const { svc } = setup();
    expect(await svc.getForPull('ws1', 'nope')).toBeUndefined();
  });

  it('groups files by role with active finding lines wired through', async () => {
    const { svc } = setup();
    const out = await svc.getForPull('ws1', 'pr1');
    const files = out!.groups.flatMap((g) => g.files);
    expect(files.map((f) => f.path).sort()).toEqual(['src/a.test.ts', 'src/a.ts']);
    expect(files.find((f) => f.path === 'src/a.ts')!.finding_lines).toEqual([7]);
    expect(out!.groups.length).toBeGreaterThan(1);
  });

  // No LLM/GitHub call is pinned behaviourally by the tripwire (calls === 0) in reviews-smart-diff.it.test.ts.
});
