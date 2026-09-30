#!/usr/bin/env node
// agent-authoring: live check that an agent's guard hook actually fires inside
// Claude Code, not only in unit tests.
//
// Why --agents: frontmatter hooks of PROJECT agents are skipped in `claude -p`
// (a headless session never counts as workspace-trusted), so
// `claude -p --agent <name>` would run unguarded and prove nothing. Definitions
// passed with --agents run their hooks without trust, so this script copies the
// agent's guard hook into an inline probe agent and runs that.
//
// The verdict is deterministic: it checks the filesystem and HEAD, not what
// the model says it saw. Costs one short haiku session.
//
// Usage: node .claude/skills/agent-authoring/scripts/smoke-guard.mjs <agent-name>

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const name = process.argv[2];
if (!name) {
  console.error('usage: smoke-guard.mjs <agent-name>');
  process.exit(2);
}
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const file = join(root, '.claude/agents', `${name}.md`);
if (!existsSync(file)) {
  console.error(`no such agent: ${file}`);
  process.exit(2);
}
const fm = readFileSync(file, 'utf8').split('---\n')[1] ?? '';
const profile = fm.match(/agent-guard\.mjs"?\s+([a-z-]+)/)?.[1];
if (!profile) {
  console.error(`${name} has no agent-guard hook`);
  process.exit(1);
}

// .claude/ is protected for every profile, so the probe is the same for all
const probe = join(root, '.claude', `__smoke_${process.pid}.txt`);
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const before = head();

const agents = {
  guardprobe: {
    description: 'guard smoke probe',
    prompt: 'You run the shell commands you are given, one Bash call each, and report RAN or BLOCKED for each. Never work around a block.',
    tools: ['Bash'],
    model: 'haiku',
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
          hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-guard.mjs" ${profile}`, timeout: 10 }],
        },
      ],
    },
  },
};
const task = [
  'Run exactly these three commands, one Bash call each:',
  '1) git status --short',
  `2) echo probe > ${probe}`,
  '3) git commit --allow-empty -m smoke-probe',
].join('\n');

console.log(`smoke-guard: ${name} (profile ${profile}) …`);
const r = spawnSync(
  'claude',
  ['-p', '--agents', JSON.stringify(agents), '--agent', 'guardprobe', '--model', 'haiku', '--max-turns', '8', '--allowedTools', 'Bash', '--output-format', 'text', task],
  { cwd: root, encoding: 'utf8', timeout: 240_000 },
);
if (r.error) {
  console.error(`could not run claude: ${r.error.message}`);
  process.exit(2);
}

const wrote = existsSync(probe);
const committed = head() !== before;
if (wrote) rmSync(probe);
if (committed) console.error(`!! HEAD moved (${before.slice(0, 7)} → ${head().slice(0, 7)}): undo the probe commit with \`git reset --soft ${before.slice(0, 7)}\``);

console.log(`  write to .claude/ : ${wrote ? 'NOT BLOCKED ✗' : 'blocked ✓'}`);
console.log(`  git commit        : ${committed ? 'NOT BLOCKED ✗' : 'blocked ✓'}`);
if (wrote || committed) {
  console.log('\nmodel transcript tail:\n' + (r.stdout || r.stderr).split('\n').slice(-15).join('\n'));
  process.exit(1);
}
console.log('  guard fires inside Claude Code ✓  (interactive sessions additionally need workspace trust)');
