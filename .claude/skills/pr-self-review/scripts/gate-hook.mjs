#!/usr/bin/env node
// pr-self-review: Claude Code PreToolUse hook for Bash.
//
// Lets `git push` / `gh pr create` through only when a PASS stamp exists for
// the branch diff of the repo the command acts on
// (<toplevel>/.devdigest/self-review/<diffHash>.json). It never runs the
// review itself: it is a file check, so it stays fast and offline.
//
// Exit codes (Claude Code hook contract): 0 = allow, 2 = block; stderr is shown
// to the agent. Anything that is not a gated command exits 0 untouched. Once a
// gated command is recognised, every failure blocks (fail-closed).
//
// Command recognition (quotes, redirects, pipes, `cd`, `git -C/-c/--git-dir`)
// lives in shell.mjs.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_BASE, branchDiff, currentBranch, git, repoRoot, stampLevel, stateDir } from './lib.mjs';
import { UNKNOWN_DIR, commands, parseGhPrCreate, parseGit } from './shell.mjs';

const HEAD_MOVERS = /^(commit|merge|rebase|cherry-pick|am|pull|reset|revert|checkout|switch|stash|restore|apply)$/;
// `git push` flags that take a separate value (which is then not the remote).
const PUSH_OPTS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

let baseCwd;

function block(message) {
  process.stderr.write(`pr-self-review gate: ${message}\n`);
  process.exit(2);
}

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0); // not a hook payload we understand, nothing to gate
  }
}

// Returns { kind: 'git', sub, args, target } | { kind: 'gh-pr-create', args, target } | null.
// `target` describes where the command runs: `-C`/`--git-dir`/`--work-tree` and a
// preceding `cd <path>` all move it away from the session cwd.
function classify(cmd) {
  const g = parseGit(cmd);
  if (g) {
    const explicit = g.cdirs.length > 0 || Boolean(g.gitDir) || Boolean(g.workTree) || cmd.cwd !== baseCwd;
    return { kind: 'git', sub: g.sub, args: g.args, target: { ...g, cwd: cmd.cwd, explicit } };
  }
  const h = parseGhPrCreate(cmd);
  if (h) return { kind: 'gh-pr-create', args: h.args, target: { cwd: cmd.cwd, cdirs: [], explicit: cmd.cwd !== baseCwd } };
  return null;
}

// The repo root + branch a gated command really acts on. The stamp must come
// from THAT repo, not from $CLAUDE_PROJECT_DIR, or a push from another worktree
// would be judged by (or skip) the wrong stamp. { error } when it cannot be pinned down.
function resolveTarget(t) {
  const why = t.explicit ? 'Команда працює не в каталозі сесії (`-C` / `--git-dir` / `--work-tree` / `cd`), ' : '';
  if (t.cwd === UNKNOWN_DIR || t.dynamic)
    return {
      error:
        `${why || 'Каталог команди '}не вдалося визначити статично (змінна, \`cd -\`, підстановка). ` +
        'Вкажи літеральний шлях, або зайди в каталог окремою командою і запусти без `-C`.',
    };
  let dir = t.cwd;
  for (const c of t.cdirs) dir = isAbsolute(c) ? c : resolve(dir, c);
  if (t.workTree) dir = isAbsolute(t.workTree) ? t.workTree : resolve(dir, t.workTree);
  let root;
  try {
    root = repoRoot(dir);
  } catch {
    if (!t.explicit) return { skip: true }; // not inside a git repo: not ours to gate
    return { error: `${why}але \`${dir}\` не git-репозиторій або недоступний, штамп перевірити неможливо.` };
  }
  if (t.gitDir) {
    const gd = isAbsolute(t.gitDir) ? t.gitDir : resolve(dir, t.gitDir);
    try {
      if (realpathSync(gd) !== realpathSync(git(root, ['rev-parse', '--absolute-git-dir']).trim()))
        return { error: `\`--git-dir ${t.gitDir}\` вказує не на репозиторій ${root}. Використай \`git -C <шлях>\`.` };
    } catch {
      return { error: `не вдалося звірити \`--git-dir ${t.gitDir}\` з ${root}. Використай \`git -C <шлях>\`.` };
    }
  }
  let branch;
  try {
    branch = currentBranch(root);
  } catch (err) {
    return { error: `не вдалося визначити гілку в ${root}: ${err.message}` };
  }
  return { root, branch };
}

// null = nothing to review in this push; otherwise the reason it must be gated.
function pushNeedsGate(args, root, branch) {
  const flags = args.filter((a) => a.startsWith('-'));
  if (flags.some((f) => ['--tags', '--delete', '-d', '--dry-run', '-n'].includes(f))) return null;
  if (flags.some((f) => ['--all', '--mirror', '--branches'].includes(f)))
    return { error: '`--all`/`--mirror` пушить інші гілки, для них штампа немає. Пуш по одній гілці.' };
  const positional = [];
  for (let k = 0; k < args.length; k++) {
    if (PUSH_OPTS_WITH_VALUE.has(args[k])) k++;
    else if (!args[k].startsWith('-')) positional.push(args[k]);
  }
  const refspecs = positional.slice(1); // first positional is the remote
  if (refspecs.length === 0) return { ok: true };
  let pushesCode = false;
  for (const raw of refspecs) {
    const spec = raw.replace(/^\+/, '');
    if (spec.startsWith(':')) continue; // delete
    const [src] = spec.split(':');
    if (src.startsWith('refs/tags/') || isTag(root, src)) continue;
    if (src !== 'HEAD' && src !== branch && src !== `refs/heads/${branch}`)
      return { error: `пуш \`${src}\` не з поточної гілки (${branch}). Штамп описує лише поточну гілку: зроби checkout \`${src}\` і пуш звідти.` };
    pushesCode = true;
  }
  return pushesCode ? { ok: true } : null;
}

function isTag(root, name) {
  try {
    git(root, ['show-ref', '--verify', '--quiet', `refs/tags/${name}`]);
    return true;
  } catch {
    return false;
  }
}

function ghHead(args) {
  const i = args.findIndex((a) => a === '--head' || a === '-H');
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith('--head='))?.slice('--head='.length);
}

function main() {
  const input = readInput();
  if (input.tool_name !== 'Bash') process.exit(0);
  const command = String(input.tool_input?.command ?? '');
  // Cheap pre-filter; the tokenizer decides. Must let `git -C x push` and `gh -R x pr create` through.
  if (!/\bgit\b[\s\S]*\bpush\b|\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/.test(command)) process.exit(0);

  baseCwd = resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const parsed = commands(command, baseCwd).map(classify);
  const isGated = (p) => p && ((p.kind === 'git' && p.sub === 'push') || p.kind === 'gh-pr-create');
  const gatedAt = parsed.findIndex(isGated);
  if (gatedAt === -1) process.exit(0);

  // One stamp check per distinct repo root. git push accepts a PASS of level
  // "checks" or "full"; gh pr create needs "full". A chain touching both in the
  // same repo (rare) is held to "full", the stricter one.
  const checks = new Map(); // root -> { branch, requiredLevel }
  for (const p of parsed.slice(gatedAt)) {
    if (!isGated(p)) continue;
    const target = resolveTarget(p.target);
    if (target.error) block(target.error);
    if (target.skip) continue;
    const { root, branch } = target;
    let level;
    if (p.kind === 'git') {
      const r = pushNeedsGate(p.args, root, branch);
      if (r?.error) block(r.error);
      if (r?.ok) level = 'checks';
    } else {
      const head = ghHead(p.args);
      if (head && head !== branch && !head.endsWith(`:${branch}`))
        block(`\`gh pr create --head ${head}\` відкриває PR не з поточної гілки (${branch}). Зроби checkout цієї гілки і повтори.`);
      level = 'full';
    }
    if (!level) continue;
    const prev = checks.get(root);
    checks.set(root, { branch, requiredLevel: prev?.requiredLevel === 'full' || level === 'full' ? 'full' : 'checks' });
  }
  if (checks.size === 0) process.exit(0);

  // A commit (or anything that moves HEAD) earlier in the same command would be
  // pushed without review: the hook only sees HEAD as it is right now.
  const mover = parsed.slice(0, gatedAt).find((p) => p?.kind === 'git' && HEAD_MOVERS.test(p.sub ?? ''));
  if (mover)
    block(
      `команда змінює HEAD (\`git ${mover.sub}\`) і одразу пушить. Hook бачить HEAD до цієї зміни, тож новий коміт пішов би без рев'ю. ` +
        'Розбий на кроки: спершу коміт, потім /pr-self-review, потім push або gh pr create.',
    );

  for (const [root, { branch, requiredLevel }] of checks) verifyStamp(root, branch, requiredLevel);
  process.exit(0);
}

// Blocks (exit 2) unless `root` holds a valid PASS stamp of a sufficient level
// for its current branch diff. Returns normally when the command may go through.
function verifyStamp(root, branch, requiredLevel) {
  let sessionRoot;
  try {
    sessionRoot = repoRoot(baseCwd);
  } catch {
    sessionRoot = undefined;
  }
  const other = root !== sessionRoot;
  const where = other ? ` (репозиторій ${root})` : '';
  // The exact command to name in a block message: the minimal self-review that
  // would satisfy what is actually being gated.
  const suggestedCmd =
    (requiredLevel === 'full' ? '/pr-self-review' : '/pr-self-review --checks-only') + (other ? ` (запусти з каталогу ${root})` : '');

  let diff;
  try {
    diff = branchDiff(root, DEFAULT_BASE);
  } catch (err) {
    block(`${err.message}${where}`);
  }
  if (diff.patch.length === 0) return; // nothing committed on top of main

  const stampPath = join(stateDir(root), `${diff.diffHash}.json`);
  if (!existsSync(stampPath))
    block(
      `немає PASS-вердикту для поточного diff гілки ${branch}${where} (diffHash ${diff.diffHash.slice(0, 12)}). ` +
        `Запусти ${suggestedCmd} вручну (автовиклик вимкнено). Після PASS повтори цю саму команду.`,
    );
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    block(`штамп ${stampPath} пошкоджений. Запусти ${suggestedCmd} ще раз вручну (автовиклик вимкнено).`);
  }
  if (stamp.diffHash !== diff.diffHash) block(`штамп не відповідає поточному diff. Запусти ${suggestedCmd} ще раз вручну (автовиклик вимкнено).`);
  if (stamp.verdict !== 'PASS') {
    const list = (stamp.blocking ?? []).slice(0, 10).map((b) => `  - ${b}`).join('\n');
    block(`останній self-review дав BLOCK (${stamp.criticals} critical). Виправ, закоміть і запусти ${suggestedCmd} знову вручну (автовиклик вимкнено).\n${list}`);
  }
  // A stamp without `level` predates checks-only and counts as full (stampLevel()).
  if (requiredLevel === 'full' && stampLevel(stamp) !== 'full')
    block(
      `останній self-review — рівень "${stampLevel(stamp)}" (лише детерміновані перевірки), а для gh pr create потрібен повний прогін з лінзами. ` +
        `Запусти ${suggestedCmd}.`,
    );
}

try {
  main();
} catch (err) {
  block(`внутрішня помилка hook: ${err.message}`);
}
