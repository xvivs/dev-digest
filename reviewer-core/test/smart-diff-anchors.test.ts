/**
 * Smart Diff classifier: anchoring / segment boundaries and the structural ACs
 * (AC-1 purity, AC-2 single definition). Complements smart-diff-classify.test.ts,
 * which pins the table of expected roles; these cases each fail if a pattern
 * loses its anchor or a role changes priority.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifyFile, ROLE_ORDER } from '../src/index.js';

const SRC = join(__dirname, '..', 'src');

describe('classifyFile anchors', () => {
  it.each([
    // a substring of a segment must not match a segment pattern
    ['src/reindex.ts', 'core'],
    ['src/myindex.js', 'core'],
    ['src/environment.ts', 'core'], // `.env*` needs a leading dot
    ['src/contest/run.ts', 'core'], // `test/` only as a whole segment
    ['src/attests/a.ts', 'core'],
    ['src/my__tests__/a.ts', 'core'],
    // docs/dist/build are root-anchored
    ['src/docs/guide.ts', 'core'],
    ['src/build/a.ts', 'core'],
    // other near-misses
    ['package.json', 'core'], // not wiring
    ['src/a.spec.tsx', 'core'], // only *.spec.ts is a tests pattern
    ['my.lock.ts', 'core'], // `.lock` must be the extension
    ['src/index.tsx', 'core'], // barrel is index.ts/js only
    ['src/a.test.js', 'core'], // tests: .ts/.tsx only
    // case-insensitive doc names, nested too
    ['packages/x/readme', 'docs'],
    ['packages/x/Changelog', 'docs'],
    ['license', 'docs'],
    // nested placement of segment patterns
    ['packages/x/tsconfig.base.json', 'wiring'],
    ['packages/x/.env.local', 'wiring'],
    ['deep/er/__snapshots__/a.txt', 'boilerplate'],
    ['deep/er/docker-compose.override.yml', 'wiring'],
    // priority: boilerplate > tests > wiring > docs
    ['e2e/vitest.config.ts', 'tests'],
    ['src/__tests__/index.ts', 'tests'],
    ['.github/README.md', 'wiring'],
    ['test/fixtures/pnpm-lock.yaml', 'boilerplate'],
    ['docs/pnpm-lock.yaml', 'boilerplate'],
  ] as const)('%s → %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('is deterministic and total: every result is a ROLE_ORDER member', () => {
    for (const p of ['', '/', 'a', '..//x', 'é/ü.ts', 'x'.repeat(5000)]) {
      expect(ROLE_ORDER).toContain(classifyFile(p));
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('smart-diff module structure', () => {
  const files = walk(join(SRC, 'smart-diff')).filter((f) => f.endsWith('.ts'));

  it('AC-1: smart-diff files import only each other and `import type` from @devdigest/shared', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const imports = readFileSync(f, 'utf8').match(/^\s*import\s[^;]*?from\s+['"][^'"]+['"]/gm) ?? [];
      for (const line of imports) {
        const spec = /from\s+['"]([^'"]+)['"]/.exec(line)![1]!;
        if (spec.startsWith('./')) continue;
        expect(spec, `${f}: ${line}`).toBe('@devdigest/shared');
        expect(line, `${f} must use import type`).toMatch(/^\s*import\s+type\s/);
      }
    }
  });

  it('AC-2: ROLE_ORDER / CLASSIFY_ORDER / ROLE_PATTERNS are declared only in smart-diff/constants.ts', () => {
    const decl = /(?:const|let|var)\s+(ROLE_ORDER|CLASSIFY_ORDER|ROLE_PATTERNS)\b/;
    const hits = walk(SRC)
      .filter((f) => f.endsWith('.ts') && decl.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1));
    expect(hits).toEqual(['smart-diff/constants.ts']);
  });
});
