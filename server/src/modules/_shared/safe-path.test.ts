import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveSafeRepoPath, UnsafePathError } from './safe-path.js';

describe('resolveSafeRepoPath', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'safe-path-')));
    root = path.join(base, 'clone');
    outside = path.join(base, 'outside');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, 'src', 'a.ts'), 'x');
    await writeFile(path.join(outside, 'secret.txt'), 's');
    await symlink(outside, path.join(root, 'escape-dir'));
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape-file'));
    await symlink('src', path.join(root, 'inner-link'));
    await symlink('a.ts', path.join(root, 'src', 'file-link'));
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('resolves a plain relative path under the root', async () => {
    expect(await resolveSafeRepoPath(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'));
  });

  it('accepts a not-yet-existing path (read reports ENOENT)', async () => {
    expect(await resolveSafeRepoPath(root, 'src/missing.ts')).toBe(path.join(root, 'src', 'missing.ts'));
  });

  it.each([
    ['dot-dot segment', '../outside/secret.txt'],
    ['nested dot-dot', 'src/../../outside/secret.txt'],
    ['absolute path', '/etc/passwd'],
    ['NUL byte', 'src/a.ts\0.png'],
    ['empty path', ''],
    ['symlinked directory escaping the root', 'escape-dir/secret.txt'],
    ['symlinked file escaping the root', 'escape-file'],
  ])('rejects %s', async (_name, rel) => {
    await expect(resolveSafeRepoPath(root, rel)).rejects.toBeInstanceOf(UnsafePathError);
  });

  it('rejects a symlink that stays inside the root (any segment is refused)', async () => {
    await expect(resolveSafeRepoPath(root, 'inner-link/a.ts')).rejects.toBeInstanceOf(UnsafePathError);
    await expect(resolveSafeRepoPath(root, 'src/file-link')).rejects.toBeInstanceOf(UnsafePathError);
  });
});
