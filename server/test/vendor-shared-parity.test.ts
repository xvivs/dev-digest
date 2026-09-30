/**
 * AC-5: `@devdigest/shared` is vendored twice with no sync script. Fails when
 * the server and client copies differ in any file (content or presence).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = join(__dirname, '..', 'src', 'vendor', 'shared');
const CLIENT = join(__dirname, '..', '..', 'client', 'src', 'vendor', 'shared');

function tree(root: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(root, rel))) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(root, r)).isDirectory()) Object.assign(out, tree(root, r));
    else out[r] = readFileSync(join(root, r), 'utf8');
  }
  return out;
}

describe('vendored @devdigest/shared', () => {
  it('server and client copies are identical', () => {
    const a = tree(SERVER);
    const b = tree(CLIENT);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    const differing = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(differing).toEqual([]);
  });

  it('SmartDiffRole is the five roles in display order', async () => {
    const { SmartDiffRole } = await import('@devdigest/shared');
    expect(SmartDiffRole.options).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
  });
});
