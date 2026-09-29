/**
 * Path guard for reading files out of a cloned repo. `GitClient.readFile` has
 * no guard of its own, and repo content is untrusted (a symlink committed to
 * the repo can point anywhere on the host).
 */
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../platform/errors.js';

export class UnsafePathError extends AppError {
  constructor(relPath: string, reason: string) {
    super('unsafe_path', `Refusing to read "${relPath.replace(/\0/g, '\\0')}": ${reason}`, 422, { reason });
  }
}

/**
 * Resolve `relPath` under `cloneRoot` or throw `UnsafePathError`. Rejects
 * absolute paths, `..` segments, NUL bytes, a symlink at ANY segment, and a
 * realpath outside `realpath(cloneRoot)`. A non-existent path is not an
 * escape: it resolves lexically and the caller's read reports ENOENT.
 */
export async function resolveSafeRepoPath(cloneRoot: string, relPath: string): Promise<string> {
  if (relPath.length === 0) throw new UnsafePathError(relPath, 'empty path');
  if (relPath.includes('\0')) throw new UnsafePathError(relPath, 'contains NUL');
  if (path.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) {
    throw new UnsafePathError(relPath, 'absolute path');
  }
  const segments = relPath.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.');
  if (segments.includes('..')) throw new UnsafePathError(relPath, 'contains ".." segment');

  const root = await realpath(cloneRoot);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw err;
    }
    if (stat.isSymbolicLink()) throw new UnsafePathError(relPath, 'symlink in path');
  }

  const resolved = path.join(root, ...segments);
  let real = resolved;
  try {
    real = await realpath(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new UnsafePathError(relPath, 'escapes the clone root');
  }
  return resolved;
}
