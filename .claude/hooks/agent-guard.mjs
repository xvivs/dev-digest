#!/usr/bin/env node
// agent-guard: Claude Code PreToolUse hook for the dev subagents in .claude/agents/.
//
// Each agent's frontmatter runs this with one profile argument:
//
//   readonly  no file writes at all (temp dirs excepted), no mutating shell commands
//   specs     writes only plans: specs/**, <pkg>/specs/** (not e2e/specs, those are flows)
//   tests     writes only test paths (see TEST_PATHS)
//   docs      writes only docs/**, <pkg>/docs/**
//   insights  writes only INSIGHTS.md / INSIGHTS-<Domain>.md
//   impl      writes anywhere in the repo except PROTECTED paths
//
// Every profile also refuses PROTECTED paths, anything outside the repo that is
// not a temp dir, history-rewriting / publishing git commands, and the
// commands AGENTS.md forbids (`docker compose down -v`, `--no-verify`, …).
//
// Agent calls, for every profile: the child type must be listed in the
// caller's one `Spawns:` line (`Agent(x)` allowlists are ignored in subagent
// `tools`, so that line is the allowlist). A `Spawns:` line that says
// "no sub-spawn" outside backticks also requires that phrase in the child's
// prompt. The caller is `agent_type` from the payload, looked up in
// .claude/agents/.
//
// This is defense in depth, not a sandbox: `node -e "fs.writeFileSync(…)"` and
// similar interpreter one-liners are not parsed. The agent prompts state the
// same rules; this hook catches the accidental violation, not a determined one.
//
// Contract: exit 0 with no output = no opinion (normal permission flow);
// exit 0 with a `permissionDecision: "deny"` JSON = block, reason shown to the
// agent. Unknown profile or an unparsable payload blocks (fail-closed).

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const PROFILES = new Set(['readonly', 'specs', 'tests', 'docs', 'insights', 'impl']);
const PACKAGES = ['server', 'client', 'reviewer-core', 'e2e'];

const TEST_PATHS = [
  /^server\/test\//,
  /^server\/src\/.+\.test\.ts$/,
  /^client\/src\/.+\.test\.tsx?$/,
  /^client\/src\/test\//,
  /^reviewer-core\/test\//,
  /^reviewer-core\/src\/.+\.test\.ts$/,
  /^e2e\/specs\/[^/]+\.flow\.json$/,
  /^fixtures\//,
];

const INSIGHTS_FILE = /^INSIGHTS(-[A-Za-z0-9-]+)?\.md$/;

// Never written by any agent. Reason is shown to the agent verbatim.
const PROTECTED = [
  [/^\.git(\/|$)/, 'git internals'],
  [/^\.claude\//, 'agent/skill/hook definitions are human-owned'],
  [/^\.cursor\//, 'symlink to .claude/'],
  [/^\.devdigest\//, 'pr-self-review stamps are written only by its scripts'],
  [/(^|\/)node_modules\//, 'installed packages'],
  [/^server\/src\/db\/migrations\//, 'regenerate with `pnpm db:generate`, never hand-edit'],
  [/^server\/\.dependency-cruiser-known-violations\.json$/, 'arch baseline must not grow to hide a violation'],
  [/(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/, 'lockfiles change only through the package manager'],
  [/(^|\/)(AGENTS|CLAUDE)\.md$/, 'agent instructions are human-owned; propose the change in your report'],
];

const PROFILE_WRITES = {
  readonly: () => false,
  specs: (rel) => /^specs\//.test(rel) || /^(server|client|reviewer-core)\/specs\//.test(rel),
  tests: (rel) => TEST_PATHS.some((re) => re.test(rel)),
  docs: (rel) => /^docs\//.test(rel) || new RegExp(`^(${PACKAGES.join('|')})/docs/`).test(rel),
  insights: (rel) => INSIGHTS_FILE.test(basename(rel)),
  impl: () => true,
};

const PROFILE_SCOPE = {
  readonly: 'nothing in the repo',
  specs: 'specs/** and <pkg>/specs/**',
  tests: 'test files only (server/test/**, **/*.test.ts(x), client/src/test/**, reviewer-core/test/**, e2e/specs/*.flow.json, fixtures/**)',
  docs: 'docs/** and <pkg>/docs/**',
  insights: 'INSIGHTS.md / INSIGHTS-<Domain>.md',
  impl: 'the repo, minus protected paths',
};

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `agent-guard: ${reason}`,
      },
    }),
  );
  process.exit(0);
}

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    deny('unreadable hook payload (fail-closed)');
  }
}

function repoRoot(cwd) {
  if (process.env.CLAUDE_PROJECT_DIR) return realpath(process.env.CLAUDE_PROJECT_DIR);
  try {
    return realpath(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim());
  } catch {
    return realpath(cwd);
  }
}

// realpath of the nearest existing ancestor + the not-yet-existing tail, so a
// new file under a symlinked dir (.cursor/skills → .claude/skills) resolves to
// where it would really land.
function realpath(p) {
  let head = resolve(p);
  const tail = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    tail.unshift(basename(head));
    head = parent;
  }
  let real = head;
  try {
    real = realpathSync(head);
  } catch {
    /* keep the lexical path */
  }
  return tail.length ? resolve(real, ...tail) : real;
}

const TEMP_ROOTS = [tmpdir(), process.env.TMPDIR, '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
  .filter(Boolean)
  .map((p) => realpath(p));

function inside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Returns null when the write is allowed, else a reason string.
function checkWrite(profile, root, target, base) {
  if (target === '/dev/null' || target === '/dev/stdout' || target === '/dev/stderr') return null;
  const abs = realpath(isAbsolute(target) ? target : resolve(base, target));
  if (TEMP_ROOTS.some((t) => inside(abs, t))) return null;
  if (!inside(abs, root)) return `${target} is outside the repository and not a temp dir`;
  const rel = relative(root, abs).split(sep).join('/');
  const insightsException = profile === 'insights' && INSIGHTS_FILE.test(basename(rel));
  for (const [re, why] of PROTECTED) {
    if (re.test(rel)) return `${rel} is protected: ${why}`;
  }
  if (INSIGHTS_FILE.test(basename(rel)) && !insightsException) {
    return `${rel}: INSIGHTS files are written only through the engineering-insights script — report the candidate instead`;
  }
  if (!PROFILE_WRITES[profile](rel)) return `${rel} is outside this agent's write scope (${PROFILE_SCOPE[profile]})`;
  return null;
}

// ---------------------------------------------------------------- Bash

// Naive shell split (quotes not parsed). Errs toward blocking: a quoted
// "git push" inside an echo is treated as a push.
function segments(command) {
  return command
    .split(/&&|\|\||;|\||\n|\$\(|`|\)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokens(segment) {
  return segment.split(/\s+/).filter(Boolean);
}

const GIT_READONLY = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'merge-base', 'ls-files', 'ls-tree',
  'grep', 'cat-file', 'describe', 'shortlog', 'reflog', 'rev-list', 'name-rev', 'for-each-ref', 'config',
]);
const GIT_BRANCH_LIST = /^(--show-current|--list|-a|-r|-v|-vv|--all|--remotes|--contains|--merged|--no-merged)$/;

const INSTALL = /^(add|install|i|ci|remove|rm|uninstall|un|update|up|upgrade|link|unlink|patch|patch-commit|rebuild)$/;

function checkBash(profile, root, command, cwd) {
  if (/--no-verify\b/.test(command)) return '`--no-verify` bypasses the self-review gate';
  if (/docker\s+compose\s+down\b[^\n;&|]*\s-(v\b|-volumes\b)/.test(command) || /docker\s+volume\s+(rm|prune)\b/.test(command)) {
    return 'dropping the devdigest_pgdata volume is forbidden (AGENTS.md) — drop and re-migrate the database instead';
  }
  if (/\b(curl|wget)\b[^\n;&]*\|\s*(ba|z)?sh\b/.test(command)) return 'piping a download into a shell';

  let base = cwd;
  for (const seg of segments(command)) {
    const t = tokens(seg);
    let i = 0;
    while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++; // env assignments
    while (['sudo', 'command', 'nohup', 'time', 'xargs', 'env'].includes(t[i])) i++;
    const cmd = t[i];
    const args = t.slice(i + 1);
    if (!cmd) continue;

    // redirects: `> file`, `>> file`, `2> file`, `&> file`, `>file`
    for (const m of seg.matchAll(/(?:^|[^<>&0-9=\\-])(?:[0-9]|&)?>{1,2}\|?\s*([^\s&|;<>()]+)/g)) {
      const target = m[1];
      if (/^&?[0-9-]$/.test(target)) continue; // 2>&1, >&2
      const why = checkWrite(profile, root, target, base);
      if (why) return `redirect: ${why}`;
    }

    if (cmd === 'cd') {
      if (args[0] && !args[0].startsWith('-')) base = resolve(base, args[0].replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
      continue;
    }
    if (['bash', 'sh', 'zsh', 'eval', 'exec', 'source', '.'].includes(cmd) && args.length) {
      return `\`${cmd}\` hides the real command from this guard — run it directly`;
    }
    if (cmd === 'npx' || cmd === 'bunx' || (['pnpm', 'yarn', 'bun'].includes(cmd) && args[0] === 'dlx')) {
      return '`npx` / `pnpm dlx` downloads and runs unpinned code — use `pnpm exec` / `npm exec` for installed binaries';
    }

    if (cmd === 'git') {
      let j = 0;
      while (j < args.length && args[j].startsWith('-')) j += args[j] === '-C' || args[j] === '-c' ? 2 : 1;
      const sub = args[j];
      const rest = args.slice(j + 1);
      if (sub === 'config' && !rest.some((a) => /^(--get.*|--list|-l)$/.test(a))) return '`git config` writes are not allowed';
      if (!sub || GIT_READONLY.has(sub)) continue;
      if (sub === 'branch' && rest.every((a) => GIT_BRANCH_LIST.test(a) || !a.startsWith('-')) && rest.filter((a) => !a.startsWith('-')).length === 0) continue;
      if (sub === 'stash' && ['list', 'show'].includes(rest[0])) continue;
      if (sub === 'worktree' && rest[0] === 'list') continue;
      if (sub === 'remote' && (rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url')) continue;
      if (sub === 'fetch' && profile !== 'readonly') continue;
      if (sub === 'mv' && profile === 'impl') {
        for (const a of rest.filter((x) => !x.startsWith('-'))) {
          const why = checkWrite(profile, root, a, base);
          if (why) return `git mv: ${why}`;
        }
        continue;
      }
      return `\`git ${sub}\` is not allowed for subagents — commits, pushes, branch moves and the shared stash belong to the orchestrator`;
    }

    if (['pnpm', 'npm', 'yarn', 'bun'].includes(cmd)) {
      const positional = args.filter((a) => !a.startsWith('-'));
      // `pnpm run x` / `npm run-script x` name the script one token later
      const sub = ['run', 'run-script'].includes(positional[0]) ? positional[1] : positional[0];
      if (sub && INSTALL.test(sub)) {
        if (profile !== 'impl') return `\`${cmd} ${sub}\` changes dependencies — only the implementer may, and only when the plan says so`;
        continue;
      }
      if (sub === 'arch:baseline') return 'regenerating the arch baseline hides violations (server/AGENTS.md)';
      if (sub && /^db:(migrate|seed|generate|push|drop)$/.test(sub) && profile !== 'impl') return `\`${cmd} ${sub}\` mutates the database or migrations`;
      continue;
    }

    if (cmd === 'sed' && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place' || a.startsWith('--in-place='))) {
      return '`sed -i` edits files outside the Edit tool — use Edit/Write so the path is checked';
    }
    if (cmd === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a))) return '`perl -i` edits files in place — use Edit/Write';

    if (['rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir', 'ln', 'tee', 'truncate', 'chmod', 'chown', 'install', 'rsync', 'unlink'].includes(cmd)) {
      const targets = args.filter((a) => !a.startsWith('-'));
      // cp/mv/ln/rsync/install: only the destination is written; rm/touch/…: every operand
      const written = ['cp', 'mv', 'ln', 'rsync', 'install'].includes(cmd) ? (cmd === 'mv' ? targets : targets.slice(-1)) : targets;
      if (cmd === 'rm' && args.some((a) => /^-[a-zA-Z]*[rR]/.test(a)) && written.some((a) => a === '/' || a === '~' || a === '.' || a === '..' || a === '*')) {
        return 'recursive rm on a root-like path';
      }
      for (const a of written) {
        const why = checkWrite(profile, root, a, base);
        if (why) return `\`${cmd}\`: ${why}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- Agent

const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/i;
const NO_SUB_SPAWN = /no sub-spawn/i;

// The caller's `Spawns:` line, parsed the way validate-agents.mjs parses it:
// every backticked name is an allowed child. null = not found (fail-closed).
function spawnPolicy(root, agentType) {
  const dir = resolve(root, '.claude/agents');
  if (!existsSync(dir)) return null;
  let text = null;
  const direct = resolve(dir, `${agentType}.md`);
  if (existsSync(direct)) text = readFileSync(direct, 'utf8');
  else {
    // name differs from the file name (the validator warns about it)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const t = readFileSync(resolve(dir, f), 'utf8');
      const fm = t.startsWith('---') ? t.split('---\n')[1] ?? '' : '';
      if (fm.split('\n').some((l) => l.trim() === `name: ${agentType}`)) {
        text = t;
        break;
      }
    }
  }
  if (text === null) return null;
  const lines = text.split('\n').filter((l) => /^Spawns:/.test(l));
  if (lines.length !== 1) return null;
  return {
    allowed: new Set([...lines[0].matchAll(/`([a-zA-Z][a-zA-Z0-9-]*)`/g)].map((m) => m[1])),
    noSubSpawn: NO_SUB_SPAWN.test(lines[0].replace(/`[^`]*`/g, '')),
  };
}

function checkAgent(root, agentType, ti) {
  if (!agentType) return 'Agent call without `agent_type` in the hook payload (fail-closed)';
  if (!AGENT_NAME.test(agentType)) return `unexpected agent_type "${agentType}" (fail-closed)`;
  const policy = spawnPolicy(root, agentType);
  if (!policy) return `no single \`Spawns:\` line for ${agentType} in .claude/agents/ (fail-closed)`;
  const child = ti.subagent_type || 'general-purpose';
  if (!policy.allowed.has(child)) {
    const list = [...policy.allowed].join(', ') || 'nothing';
    return `${agentType} may spawn only ${list} (its \`Spawns:\` line), not \`${child}\` — do the work yourself or report the gap`;
  }
  if (policy.noSubSpawn && !NO_SUB_SPAWN.test(String(ti.prompt ?? ''))) {
    return `children of ${agentType} must carry \`no sub-spawn\` in their prompt (concurrency budget, docs/dev-agents.md)`;
  }
  return null;
}

// ---------------------------------------------------------------- main

const profile = process.argv[2];
if (!PROFILES.has(profile)) deny(`unknown profile "${profile}" (fail-closed)`);

const input = readInput();
const cwd = input.cwd || process.cwd();
const root = repoRoot(cwd);
const tool = input.tool_name;
const ti = input.tool_input ?? {};

let reason = null;
if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
  const target = ti.file_path ?? ti.notebook_path;
  if (!target) reason = `${tool} without a file path (fail-closed)`;
  else reason = checkWrite(profile, root, target, cwd);
} else if (tool === 'Bash') {
  reason = checkBash(profile, root, String(ti.command ?? ''), cwd);
} else if (tool === 'Agent' || tool === 'Task') {
  reason = checkAgent(root, input.agent_type, ti);
}

if (reason) deny(`[${profile}] ${reason}`);
process.exit(0);
