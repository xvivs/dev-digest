import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { PR_490_FILES, PR_491_FILES, PR_492_FILES, type SeedPrFile } from './seed.js';

/**
 * Proves the SPEC-02 control-experiment `pr_files.patch` fixtures
 * (specs/02-skills-rubric.md) are real, parseable unified diffs — not just
 * plausible-looking template strings. This is the exact reconstruction
 * `diffFromPrFiles` (server/src/modules/reviews/diff-loader.ts) does with a
 * repo's persisted `pr_files` rows, run here without a database: seed.ts's
 * repo (`acme/payments-api`) has `clonePath: null`, so every review of
 * #490/#491/#492 goes through this fallback in practice.
 *
 * Pure: no I/O, no DB — safe to run in the unit lane (not `*.it.test.ts`).
 */

/** Mirrors `diffFromPrFiles` in diff-loader.ts: prepend the diff/file
 *  headers `parseUnifiedDiff` expects, then join per-file patches. */
function reconstructDiff(files: SeedPrFile[]): string {
  const parts: string[] = [];
  for (const f of files) {
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parts.join('\n');
}

/** Recount additions/deletions straight from the hunk body, independent of
 *  `parseUnifiedDiff`'s own bookkeeping — catches a typo in a fixture's
 *  declared `additions`/`deletions` that happens to still parse. */
function countChangedLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

describe.each([
  ['#490 Add refund amount validation', PR_490_FILES],
  ['#491 Use paymentId route param and require currency', PR_491_FILES],
  ['#492 (held-out) Paginate list refunds', PR_492_FILES],
] as const)('seeded control-experiment diff: %s', (_label, seededFiles) => {
  it('every pr_files.patch has a hunk header parseUnifiedDiff accepts', () => {
    for (const f of seededFiles) {
      expect(f.patch).toMatch(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/);
    }
  });

  it('reconstructs into a UnifiedDiff with every file and at least one hunk each', () => {
    const diff = parseUnifiedDiff(reconstructDiff(seededFiles));
    expect(diff.files.length).toBe(seededFiles.length);
    for (const parsedFile of diff.files) {
      expect(parsedFile.hunks.length).toBeGreaterThan(0);
      expect(parsedFile.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
    }
  });

  it('parsed file paths match the seeded pr_files paths, in order', () => {
    const diff = parseUnifiedDiff(reconstructDiff(seededFiles));
    expect(diff.files.map((f) => f.path)).toEqual(seededFiles.map((f) => f.path));
  });

  it('declared additions/deletions match what the patch body actually contains', () => {
    for (const f of seededFiles) {
      expect(countChangedLines(f.patch)).toEqual({
        additions: f.additions,
        deletions: f.deletions,
      });
    }
  });

  it("parseUnifiedDiff's own additions/deletions tally agrees too", () => {
    const diff = parseUnifiedDiff(reconstructDiff(seededFiles));
    for (const [i, parsedFile] of diff.files.entries()) {
      const expected = seededFiles[i]!;
      expect(parsedFile.additions).toBe(expected.additions);
      expect(parsedFile.deletions).toBe(expected.deletions);
    }
  });
});

describe('seeded control-experiment defect line numbers (specs/02-skills-rubric.md)', () => {
  it('#490: the untested throw branch sits at new-side lines 6-8 of service.ts', () => {
    const diff = parseUnifiedDiff(reconstructDiff(PR_490_FILES));
    const serviceFile = diff.files.find((f) => f.path === 'src/refunds/service.ts');
    const hunk = serviceFile?.hunks[0];
    expect(hunk?.newLineNumbers).toEqual(expect.arrayContaining([6, 7, 8]));
  });

  it('#491: currency/route/response-field breaks sit at new-side lines 7, 11-12, 15, 26', () => {
    const diff = parseUnifiedDiff(reconstructDiff(PR_491_FILES));
    const routeFile = diff.files.find((f) => f.path === 'src/api/payments.ts');
    const hunk = routeFile?.hunks[0];
    expect(hunk?.newLineNumbers).toEqual(
      expect.arrayContaining([7, 11, 12, 15, 26]),
    );
  });

  it('#492: the untested cursor branch (8-10) and the breaking response shape (13-20) both land where the rubric says', () => {
    const diff = parseUnifiedDiff(reconstructDiff(PR_492_FILES));
    const routeFile = diff.files.find((f) => f.path === 'src/api/refunds.ts');
    const hunk = routeFile?.hunks[0];
    expect(hunk?.newLineNumbers).toEqual(
      expect.arrayContaining([8, 9, 10, 13, 14, 19, 20]),
    );
  });
});
