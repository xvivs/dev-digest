#!/usr/bin/env node
// pr-self-review: Claude Code PreToolUse hook for Bash.
//
// Lets `git push` / `gh pr create` through only when a PASS stamp exists for
// the current branch diff (.devdigest/self-review/<diffHash>.json). It never
// runs the review itself: it is a file check, so it stays fast and offline.
//
// Exit codes (Claude Code hook contract): 0 = allow, 2 = block; stderr is shown
// to the agent. Anything that is not a gated command exits 0 untouched. Once a
// gated command is recognised, every failure blocks (fail-closed).

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_BASE, branchDiff, currentBranch, git, repoRoot, stampLevel, stateDir } from './lib.mjs';

const HEAD_MOVERS = /^(commit|merge|rebase|cherry-pick|am|pull|reset|revert|checkout|switch|stash|restore|apply)$/;

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

// Naive shell split: good enough to find commands; quotes are not parsed, so a
// quoted "git push" inside e.g. a commit message is treated as a push (blocks,
// never lets something through).
function segments(command) {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Redirects (`2>&1`, `>log`, `> log`, `&>/dev/null`, `<in`) are shell syntax,
// not arguments: left in, `git push origin HEAD 2>&1` read `2>&1` as a refspec.
const REDIRECT = /^(\d*|&)(>>?|<)(.*)$/;

function tokens(segment) {
  const out = [];
  const raw = segment.split(/\s+/).filter(Boolean);
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i].match(REDIRECT);
    if (!m) {
      out.push(raw[i]);
      continue;
    }
    if (m[3] === '') i++; // operator and target are separate tokens: `> log`
  }
  return out;
}

// Returns { kind: 'git', sub, args, dir } | { kind: 'gh-pr-create', args } | null
function parse(segment) {
  const t = tokens(segment);
  let i = 0;
  while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++; // env assignments
  if (t[i] === 'git') {
    i++;
    let dir;
    while (i < t.length && t[i].startsWith('-')) {
      if (t[i] === '-C') dir = t[++i];
      else if (t[i] === '-c') i++;
      i++;
    }
    return { kind: 'git', sub: t[i], args: t.slice(i + 1), dir };
  }
  if (t[i] === 'gh' && t[i + 1] === 'pr' && t[i + 2] === 'create') return { kind: 'gh-pr-create', args: t.slice(i + 3) };
  return null;
}

// null = nothing to review in this push; otherwise the reason it must be gated.
function pushNeedsGate(args, root, branch) {
  const flags = args.filter((a) => a.startsWith('-'));
  if (flags.some((f) => ['--tags', '--delete', '-d', '--dry-run', '-n'].includes(f))) return null;
  if (flags.some((f) => ['--all', '--mirror', '--branches'].includes(f)))
    return { error: '`--all`/`--mirror` пушить інші гілки, для них штампа немає. Пуш по одній гілці.' };
  const positional = args.filter((a) => !a.startsWith('-'));
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

function main() {
  const input = readInput();
  if (input.tool_name !== 'Bash') process.exit(0);
  const command = String(input.tool_input?.command ?? '');
  if (!/\bgit\b[^\n]*\bpush\b|\bgh\s+pr\s+create\b/.test(command)) process.exit(0);

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const parsed = segments(command).map(parse);
  const gatedAt = parsed.findIndex((p) => p && ((p.kind === 'git' && p.sub === 'push') || p.kind === 'gh-pr-create'));
  if (gatedAt === -1) process.exit(0);

  let root;
  try {
    const dir = parsed[gatedAt].dir;
    root = repoRoot(dir ? (isAbsolute(dir) ? dir : resolve(cwd, dir)) : cwd);
  } catch {
    process.exit(0); // not inside a git repo: not ours to gate
  }
  let branch;
  try {
    branch = currentBranch(root);
  } catch (err) {
    block(`не вдалося визначити гілку: ${err.message}`);
  }

  let needsGate = false;
  // git push accepts a PASS of level "checks" or "full"; gh pr create needs "full".
  // A command chain touching both (rare) is held to "full", the stricter one.
  let requiredLevel;
  for (const p of parsed.slice(gatedAt)) {
    if (!p) continue;
    if (p.kind === 'git' && p.sub === 'push') {
      const r = pushNeedsGate(p.args, root, branch);
      if (r?.error) block(r.error);
      if (r?.ok) {
        needsGate = true;
        requiredLevel ??= 'checks';
      }
    }
    if (p.kind === 'gh-pr-create') {
      const i = p.args.findIndex((a) => a === '--head' || a === '-H');
      const head = i >= 0 ? p.args[i + 1] : undefined;
      if (head && head !== branch && !head.endsWith(`:${branch}`))
        block(`\`gh pr create --head ${head}\` відкриває PR не з поточної гілки (${branch}). Зроби checkout цієї гілки і повтори.`);
      needsGate = true;
      requiredLevel = 'full';
    }
  }
  if (!needsGate) process.exit(0);
  // The exact command to name in a block message: the minimal self-review that
  // would satisfy what is actually being gated.
  const suggestedCmd = requiredLevel === 'full' ? '/pr-self-review' : '/pr-self-review --checks-only';

  // A commit (or anything that moves HEAD) earlier in the same command would be
  // pushed without review: the hook only sees HEAD as it is right now.
  const mover = parsed.slice(0, gatedAt).find((p) => p?.kind === 'git' && HEAD_MOVERS.test(p.sub ?? ''));
  if (mover)
    block(
      `команда змінює HEAD (\`git ${mover.sub}\`) і одразу пушить. Hook бачить HEAD до цієї зміни, тож новий коміт пішов би без рев'ю. ` +
        'Розбий на кроки: спершу коміт, потім /pr-self-review, потім push або gh pr create.',
    );

  let diff;
  try {
    diff = branchDiff(root, DEFAULT_BASE);
  } catch (err) {
    block(err.message);
  }
  if (diff.patch.length === 0) process.exit(0); // nothing committed on top of main

  const stampPath = join(stateDir(root), `${diff.diffHash}.json`);
  if (!existsSync(stampPath))
    block(
      `немає PASS-вердикту для поточного diff гілки ${branch} (diffHash ${diff.diffHash.slice(0, 12)}). ` +
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
  process.exit(0);
}

try {
  main();
} catch (err) {
  block(`внутрішня помилка hook: ${err.message}`);
}
