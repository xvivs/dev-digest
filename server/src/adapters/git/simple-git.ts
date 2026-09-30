import { simpleGit, type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { mkdir, readFile, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  ReadFileAtRefResult,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

const SHA_RE = /^[0-9a-f]{7,40}$/;
const REGULAR_FILE_MODES = new Set(['100644', '100755']);

/**
 * Per-repo in-process mutex (a keyed promise chain). `fetchPullHead` and `sync`
 * both rewrite `.git/shallow`, so they must not interleave for one clone.
 */
const repoLocks = new Map<string, Promise<unknown>>();

async function withRepoLock<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const prev = repoLocks.get(key) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(() => {
      // A timed-out waiter must never run late.
      if (signal?.aborted) throw new Error('aborted before start');
      return fn();
    });
  const tail = run.catch(() => undefined);
  repoLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (repoLocks.get(key) === tail) repoLocks.delete(key);
  }
}

/** Lexical guard for a repo-relative path taken from PR content. */
function isSafeRepoPath(path: string): boolean {
  if (path.length === 0 || path.includes('\0') || path.startsWith('-') || path.startsWith('/')) {
    return false;
  }
  if (path.endsWith('/')) return false;
  return !path.split('/').some((seg) => seg === '..' || seg === '');
}

/**
 * GitClient over simple-git. Repos clone to
 * `<cloneDir>/<owner>/<repo>`. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(private cloneDir: string) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
  }

  clonePathFor(repo: RepoRef): string {
    return join(this.cloneDir, repo.owner, repo.name);
  }

  private git(repo: RepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    await mkdir(join(this.cloneDir, repo.owner), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      // already cloned → fetch latest
      await simpleGit(dest).fetch();
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    return { path: dest };
  }

  async fetchPullHead(repo: RepoRef, n: number, opts?: { signal?: AbortSignal }): Promise<void> {
    if (!Number.isInteger(n) || n < 0) throw new Error(`invalid PR number: ${n}`);
    // Fetch the PR head ref into a local ref (GitHub exposes pull/<n>/head). The
    // leading `+` forces the update, so it still works after a force-push;
    // `--depth 1` keeps it cheap on a shallow clone.
    await withRepoLock(
      this.clonePathFor(repo),
      () =>
        this.git(repo).fetch(['origin', `+pull/${n}/head:refs/devdigest/pr-${n}`, '--depth', '1']),
      opts?.signal,
    );
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the read-only mirror to upstream. A bare `fetch` only moves
    // `origin/<branch>`, so we `reset --hard` to advance local HEAD + worktree —
    // safe here because we never commit to or run code from the clone.
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = this.git(repo);
    return withRepoLock(this.clonePathFor(repo), async () => {
      await g.fetch(['origin', branch, '--depth', String(RESYNC_FETCH_DEPTH)]);
      await g.reset(['--hard', `origin/${branch}`]);
      return { head: (await g.revparse(['HEAD'])).trim() };
    });
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    const raw = await this.git(repo).diff([`${base}...${head}`]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  async readFile(repo: RepoRef, path: string): Promise<string> {
    return readFile(join(this.clonePathFor(repo), path), 'utf8');
  }

  /**
   * Read `path` at commit `ref` from the object DB (no working tree), so a
   * symlink in the tree cannot escape the repo. Every argument is an array
   * element; `ref` is sha-validated and the path is literal (`--literal-pathspecs`).
   */
  async readFileAtRef(
    repo: RepoRef,
    ref: string,
    path: string,
    maxBytes: number,
  ): Promise<ReadFileAtRefResult> {
    if (!SHA_RE.test(ref)) return { status: 'missing_commit' };
    if (!isSafeRepoPath(path)) return { status: 'not_a_file' };
    try {
      if (!(await this.exists(join(this.clonePathFor(repo), '.git')))) {
        return { status: 'not_available' };
      }
      const g = this.git(repo);
      try {
        await g.raw(['cat-file', '-e', `${ref}^{commit}`]);
      } catch {
        return { status: 'missing_commit' };
      }
      const tree = await g.raw(['--literal-pathspecs', 'ls-tree', '-z', ref, '--', path]);
      const entry = tree.split('\0').find((e) => e.length > 0);
      if (!entry) return { status: 'not_found' };
      const m = entry.match(/^(\d{6}) (\w+) ([0-9a-f]{40,64})\t/);
      if (!m) return { status: 'not_available' };
      const [, mode, type, oid] = m;
      if (type !== 'blob' || !REGULAR_FILE_MODES.has(mode!)) return { status: 'not_a_file' };
      const size = Number((await g.raw(['cat-file', '-s', oid!])).trim());
      if (!Number.isFinite(size)) return { status: 'not_available' };
      if (size > maxBytes) return { status: 'too_large' };
      const text = await g.raw(['cat-file', 'blob', oid!]);
      return { status: 'ok', text };
    } catch {
      return { status: 'not_available' };
    }
  }
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}
