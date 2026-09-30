/**
 * classifyFile — path → Smart Diff role (specs/05-smart-diff.md, D3/D4).
 * The table pins first-match-wins order: boilerplate, tests, wiring, docs, else core.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiffRole } from '@devdigest/shared';
import { classifyFile, CLASSIFY_ORDER, ROLE_ORDER } from '../src/index.js';

type Role = 'core' | 'tests' | 'wiring' | 'docs' | 'boilerplate';

const CASES: Array<[string, Role]> = [
  // boilerplate
  ['pnpm-lock.yaml', 'boilerplate'],
  ['client/package-lock.json', 'boilerplate'],
  ['yarn.lock', 'boilerplate'],
  ['Cargo.lock', 'boilerplate'],
  ['dist/index.js', 'boilerplate'],
  ['build/out.css', 'boilerplate'],
  ['src/__snapshots__/a.snap', 'boilerplate'],
  // contested (D4): boilerplate is matched before tests
  ['src/__tests__/__snapshots__/x.snap', 'boilerplate'],
  ['api.generated.ts', 'boilerplate'],
  ['vendor/jquery.min.js', 'boilerplate'],
  ['./pnpm-lock.yaml', 'boilerplate'],
  // tests
  ['src/a.test.ts', 'tests'],
  ['src/A.test.tsx', 'tests'],
  ['server/test/reviews.it.test.ts', 'tests'],
  ['src/a.spec.ts', 'tests'],
  ['server/test/helpers/pg.ts', 'tests'],
  ['pkg/tests/x.ts', 'tests'],
  ['src/__tests__/a.ts', 'tests'],
  ['e2e/specs/05-pr-diff.flow.json', 'tests'],
  // contested (D4): e2e/** is a tests pattern and tests are matched before docs
  ['e2e/README.md', 'tests'],
  // wiring
  ['server/src/modules/index.ts', 'wiring'],
  ['lib/index.js', 'wiring'],
  ['vitest.config.ts', 'wiring'],
  ['tsconfig.json', 'wiring'],
  ['tsconfig.build.json', 'wiring'],
  ['.eslintrc.cjs', 'wiring'],
  ['.env.example', 'wiring'],
  ['docker-compose.yml', 'wiring'],
  ['.github/workflows/ci.yml', 'wiring'],
  // contested (D4): wiring is matched before docs
  ['.claude/skills/security/SKILL.md', 'wiring'],
  // docs
  ['README.md', 'docs'],
  ['docs/adr/0005-x.md', 'docs'],
  ['specs/05-smart-diff.md', 'docs'],
  ['CHANGELOG.md', 'docs'],
  ['LICENSE', 'docs'],
  ['docs/diagram.png', 'docs'],
  // core
  ['src/platform/config.ts', 'core'],
  ['src/refunds/service.ts', 'core'],
  ['src/latest/run.ts', 'core'], // `test` inside a word is not a segment
  ['client/dist/app.js', 'core'], // OQ-1: dist/ is root-anchored, pinned
  ['./src/a.ts', 'core'],
];

describe('classifyFile', () => {
  it.each(CASES)('%s → %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('classifies a 4096-character path of `a/` segments in under 5 ms', () => {
    const path = 'a/'.repeat(2047) + 'x.ts';
    expect(path.length).toBeGreaterThanOrEqual(4096 - 4);
    const t0 = performance.now();
    expect(classifyFile(path)).toBe('core');
    expect(performance.now() - t0).toBeLessThan(5);
  });

  it('keeps CLASSIFY_ORDER + core in step with ROLE_ORDER', () => {
    expect(new Set([...CLASSIFY_ORDER, 'core'])).toEqual(new Set(ROLE_ORDER));
  });

  it('keeps ROLE_ORDER identical to the contract enum', () => {
    expect([...ROLE_ORDER]).toEqual(SmartDiffRole.options);
  });
});
