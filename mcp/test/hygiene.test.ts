import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const SRC = tsFiles(path.join(ROOT, 'src'));
const TEST = tsFiles(path.join(ROOT, 'test'));

/** Every module specifier in a file (static imports, re-exports, dynamic imports). */
function specifiers(source: string): Array<{ spec: string; typeOnly: boolean }> {
  const out: Array<{ spec: string; typeOnly: boolean }> = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    const spec = m[3] ?? m[4] ?? m[5];
    if (spec) out.push({ spec, typeOnly: Boolean(m[2]) });
  }
  return out;
}

describe('stdout hygiene (AC-22)', () => {
  it('src never writes to stdout', () => {
    for (const f of SRC) {
      const s = readFileSync(f, 'utf8');
      expect(s, rel(f)).not.toMatch(/console\.(log|info|debug)/);
      expect(s, rel(f)).not.toMatch(/process\.stdout/);
    }
  });

  it('tests do not use console.log/info/debug', () => {
    for (const f of TEST) {
      if (rel(f) === 'test/hygiene.test.ts') continue;
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/console\.(log|info|debug)/);
    }
  });
});

describe('permission boundary (AC-21)', () => {
  it('fetch( appears only in src/api/client.ts', () => {
    const offenders = SRC.filter((f) => rel(f) !== 'src/api/client.ts').filter((f) =>
      /\bfetch\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('no server internals (AC-23a)', () => {
  const all = [...SRC, ...TEST];

  it('scans a non-trivial set of files', () => {
    expect(SRC.length).toBeGreaterThan(10);
    expect(specifiers("import type { A } from 'x';\nimport { B } from \"y\";")).toEqual([
      { spec: 'x', typeOnly: true },
      { spec: 'y', typeOnly: false },
    ]);
  });

  it('imports nothing from server/src and no DB or HTTP-server library', () => {
    for (const f of all) {
      for (const { spec } of specifiers(readFileSync(f, 'utf8'))) {
        expect(spec, rel(f)).not.toMatch(/(^|\/)server\/src\//);
        expect(spec, rel(f)).not.toMatch(/^(drizzle-orm|postgres|pg|fastify)(\/|$)/);
      }
    }
  });

  it('has a runtime @devdigest/shared import only in src/api/schemas.ts', () => {
    const runtime = all.filter((f) =>
      specifiers(readFileSync(f, 'utf8')).some((s) => s.spec.startsWith('@devdigest/shared') && !s.typeOnly),
    );
    expect(runtime.map(rel)).toEqual(['src/api/schemas.ts']);
  });
});
