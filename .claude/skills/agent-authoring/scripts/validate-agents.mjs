#!/usr/bin/env node
// agent-authoring: static checks for .claude/agents/*.md that Claude Code itself
// won't report. It silently ignores unknown frontmatter fields and `Agent(x)`
// allowlists, and silently skips files whose YAML doesn't parse.
//
// Usage: node .claude/skills/agent-authoring/scripts/validate-agents.mjs [agent-name ...]
// Exit 0 = no errors (warnings allowed), 1 = errors, 2 = bad invocation.
//
// The YAML reader handles the subset these files use (scalars, `- item` lists,
// the nested hooks block). If a file needs more YAML than that, keep it simple
// instead of extending this parser. Also run `claude plugin validate
// .claude/agents` for a real YAML parse.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const ROOT = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();
const AGENTS_DIR = join(ROOT, '.claude/agents');
const SKILLS_DIR = join(ROOT, '.claude/skills');
const GUARD = join(ROOT, '.claude/hooks/agent-guard.mjs');
const ROSTER = join(ROOT, 'docs/dev-agents.md');

// Verified against code.claude.com/docs/en/sub-agents (Claude Code 2.1.285).
const KNOWN_FIELDS = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills',
  'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color',
  'initialPrompt', 'experimental',
]);
const MODELS = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const KNOWN_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LSP', 'Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Skill', 'ToolSearch', 'Agent', 'SendMessage', 'Monitor',
  'TaskStop', 'Artifact', 'EnterWorktree', 'ExitWorktree',
]);
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const GUARD_MATCHER_NEEDS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'];
const BUILTIN_AGENTS = new Set(['Explore', 'Plan', 'general-purpose', 'claude']);
const MAX_DEPTH = 3; // CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH default since v2.1.219

const guardProfiles = (() => {
  if (!existsSync(GUARD)) return null;
  const m = readFileSync(GUARD, 'utf8').match(/const PROFILES = new Set\(\[([^\]]+)\]\)/);
  return m ? new Set([...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1])) : null;
})();

function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'first line must be `---` (otherwise the file is treated as documentation)' };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { error: 'no closing `---`' };
  const fm = {};
  let key = null;
  const raw = lines.slice(1, end);
  for (const line of raw) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (top) {
      key = top[1];
      if (key in fm) return { error: `duplicate key \`${key}\`` };
      const v = top[2].trim();
      fm[key] = v === '' ? [] : unquote(v);
      continue;
    }
    if (!key) return { error: `unexpected line before any key: \`${line}\`` };
    const item = line.match(/^ {2}- (.+)$/);
    if (item && Array.isArray(fm[key])) fm[key].push(unquote(item[1].trim()));
    else if (Array.isArray(fm[key])) fm[key].push({ nested: line }); // hooks block and similar
  }
  return { fm, body: lines.slice(end + 1).join('\n'), fmText: raw.join('\n') };
}

function unquote(v) {
  return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
}

function list(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
const only = process.argv.slice(2);
const results = [];
const agents = new Map(); // name -> { body, spawns:Set }

for (const f of files) {
  const text = readFileSync(join(AGENTS_DIR, f), 'utf8');
  if (!text.startsWith('---')) continue; // documentation beside the agents (e.g. README.md)
  const errors = [];
  const warns = [];
  const parsed = parseFrontmatter(text);
  if (parsed.error) {
    results.push({ f, errors: [parsed.error], warns });
    continue;
  }
  const { fm, body, fmText } = parsed;

  // identity
  if (!fm.name) errors.push('missing `name` (Claude Code treats the file as docs)');
  else {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(fm.name)) errors.push(`name \`${fm.name}\` must be kebab-case (no \`:\`, no leading \`-\`)`);
    if (`${fm.name}.md` !== f) warns.push(`name \`${fm.name}\` differs from file name — keep them equal`);
  }
  if (!fm.description) errors.push('missing `description` (Claude Code skips the file)');
  else {
    const d = String(fm.description);
    if (d.length < 120) warns.push(`description is ${d.length} chars; state what it does, what it does NOT do, and when to use it`);
    if (!/\buse (it )?(after|before|when|whenever|at|for|inside|monthly|last)\b/i.test(d) && !/\bspawned by\b/i.test(d)) {
      warns.push('description has no trigger ("Use when/after/before …" or "Spawned by …") — the main session delegates on this text');
    }
    if (/(^|[^:]): /.test(d.replace(/`[^`]*`/g, '')) && !/^(['"]).*\1$/.test(fmText.match(/^description:\s*(.*)$/m)?.[1] ?? '')) {
      errors.push('description contains `: ` outside backticks — YAML reads it as a mapping; rephrase or quote it');
    }
  }

  // fields
  for (const k of Object.keys(fm)) if (!KNOWN_FIELDS.has(k)) errors.push(`unknown field \`${k}\` — Claude Code ignores it silently`);
  if (!fm.model) warns.push('no `model` — it will follow CLAUDE_CODE_SUBAGENT_MODEL / the main model; pick one by the work');
  else if (!MODELS.has(fm.model)) warns.push(`model \`${fm.model}\` is not an alias — use sonnet/opus/haiku/fable/inherit so routing survives model releases`);
  if (fm.color && !COLORS.has(fm.color)) errors.push(`color \`${fm.color}\` not one of ${[...COLORS].join('/')}`);
  if (fm.effort && !EFFORTS.has(fm.effort)) errors.push(`effort \`${fm.effort}\` not one of ${[...EFFORTS].join('/')}`);
  if (fm.isolation && fm.isolation !== 'worktree') errors.push('isolation accepts only `worktree`');
  if (fm.isolation === 'worktree') warns.push('isolation: worktree branches from the DEFAULT branch, not the caller\'s HEAD — wrong for agents that continue a feature branch');

  // tools
  const tools = list(fm.tools);
  if (!fm.tools) warns.push('no `tools` allowlist — the agent inherits every tool, including MCP; list what it needs');
  for (const t of tools) {
    if (/^Agent\(/.test(t)) errors.push(`\`${t}\`: Agent(type) allowlists are ignored in subagent definitions — use \`Agent\` and name allowed children in the prompt`);
    else if (!KNOWN_TOOLS.has(t) && !t.startsWith('mcp__')) warns.push(`tool \`${t}\` is not a known built-in — typo? (an unresolvable list refuses to launch)`);
  }
  const writes = tools.length ? WRITE_TOOLS.some((t) => tools.includes(t)) : true;

  // guard hook
  const cmd = fmText.match(/agent-guard\.mjs"?\s+([a-z-]+)/);
  const matcher = fmText.match(/matcher:\s*"([^"]+)"/);
  if (!cmd) errors.push('no agent-guard PreToolUse hook — every dev agent runs `agent-guard.mjs <profile>`');
  else {
    const profile = cmd[1];
    if (guardProfiles && !guardProfiles.has(profile)) errors.push(`guard profile \`${profile}\` does not exist in agent-guard.mjs`);
    if (profile === 'readonly' && writes) errors.push('profile `readonly` but tools include a write tool — drop Edit/Write from tools (hard guarantee even without workspace trust)');
    if (profile !== 'readonly' && !writes) warns.push(`profile \`${profile}\` allows writes but tools have no Edit/Write`);
    const covered = matcher ? matcher[1].split('|') : [];
    const missing = GUARD_MATCHER_NEEDS.filter((t) => !covered.includes(t));
    if (missing.length) errors.push(`guard matcher misses ${missing.join(', ')} — Bash can write files too`);
    if ((tools.includes('Agent') || !tools.length) && !covered.includes('Agent')) {
      errors.push('agent can spawn but the guard matcher misses Agent — the Spawns: line is enforced only through the hook');
    }
    if (!/\$CLAUDE_PROJECT_DIR/.test(fmText)) errors.push('guard command must use "$CLAUDE_PROJECT_DIR" — relative paths break when the agent cds');
  }

  // skills
  for (const s of list(fm.skills)) {
    if (!existsSync(join(SKILLS_DIR, s, 'SKILL.md'))) errors.push(`preloaded skill \`${s}\` is not in .claude/skills/ (a user-global skill won't exist for teammates)`);
  }

  // body contract
  if (!/^## Output format/m.test(body)) errors.push('body has no `## Output format` section');
  if (!/not responsible for/i.test(body)) warns.push('body never says what the agent is NOT responsible for (and who is)');
  if (/\btools?:.*Agent/.test(`tools: ${tools.join(',')}`) && !/depth limit|Agent tool is unavailable/i.test(body)) {
    warns.push('agent can spawn but the body has no depth-limit fallback ("if the Agent tool is unavailable …")');
  }
  if (!/INSIGHTS/.test(body)) warns.push('body does not say how durable learnings are handed back (Insight candidates / never write INSIGHTS.md)');

  results.push({ f, name: fm.name, errors, warns, tools, body });
  if (fm.name) agents.set(fm.name, { body, canSpawn: tools.includes('Agent') || !fm.tools, spawns: new Set() });
}

// delegation graph: each agent body carries exactly one `Spawns: \`a\`, \`b\`` (or `Spawns: none`) line
for (const [name, a] of agents) {
  const lines = a.body.split('\n').filter((l) => /^Spawns:/.test(l));
  if (lines.length !== 1) {
    a.spawnLineError = `${name}: needs exactly one \`Spawns: \`a\`, \`b\`\` (or \`Spawns: none\`) line in the body, found ${lines.length}`;
    continue;
  }
  for (const m of lines[0].matchAll(/`([a-zA-Z][a-zA-Z0-9-]*)`/g)) a.spawns.add(m[1]);
}
const graphIssues = [];
for (const [name, a] of agents) {
  if (a.spawnLineError) graphIssues.push(`error: ${a.spawnLineError}`);
  for (const c of a.spawns) if (!agents.has(c) && !BUILTIN_AGENTS.has(c)) graphIssues.push(`error: ${name} spawns unknown agent \`${c}\``);
  if (a.spawns.has(name)) graphIssues.push(`error: ${name} spawns itself`);
  if (a.spawns.size && !a.canSpawn) graphIssues.push(`error: ${name} mentions spawning ${[...a.spawns].join(', ')} but has no \`Agent\` tool`);
}
// cycles + depth (main → agent is layer 1). Paths deeper than the limit are
// legal when the agent at the limit has a fallback; they are reported as info.
const deepPaths = new Set();
function walk(name, stack) {
  if (stack.includes(name)) {
    graphIssues.push(`error: delegation cycle ${[...stack, name].join(' → ')}`);
    return;
  }
  const path = [...stack, name];
  const a = agents.get(name);
  if (!a || a.spawns.size === 0) {
    if (path.length > MAX_DEPTH) deepPaths.add(`main → ${path.slice(0, MAX_DEPTH).join(' → ')} ⇢ (cut: ${path.slice(MAX_DEPTH).join(' → ')})`);
    return;
  }
  for (const c of a.spawns) walk(c, path);
}
for (const name of agents.keys()) walk(name, []);
for (const p of deepPaths) graphIssues.push(`info: ${p}: agents past layer ${MAX_DEPTH} don't run, the layer-${MAX_DEPTH} agent must work alone`);

// roster in docs/dev-agents.md
if (existsSync(ROSTER)) {
  const roster = readFileSync(ROSTER, 'utf8');
  for (const [name, a] of agents) {
    const row = roster.split('\n').find((l) => l.startsWith(`| \`${name}\``));
    if (!row) {
      graphIssues.push(`error: ${name} is missing from the roster table in docs/dev-agents.md`);
      continue;
    }
    const cells = row.split('|').map((c) => c.trim());
    const spawnCell = cells[cells.length - 2] ?? '';
    for (const c of a.spawns) if (!spawnCell.includes(c)) graphIssues.push(`warn: ${name} spawns ${c} (per its prompt) but the roster's Spawns column doesn't list it`);
  }
} else graphIssues.push('warn: docs/dev-agents.md not found — roster not checked');

// report
let errorCount = 0;
for (const r of results) {
  if (only.length && !only.includes(r.name ?? basename(r.f, '.md'))) continue;
  const status = r.errors.length ? 'FAIL' : r.warns.length ? 'WARN' : 'ok  ';
  console.log(`${status} ${r.f}`);
  for (const e of r.errors) console.log(`     error: ${e}`);
  for (const w of r.warns) console.log(`     warn:  ${w}`);
  errorCount += r.errors.length;
}
if (!only.length) {
  console.log('\ndelegation graph');
  for (const [name, a] of agents) console.log(`  ${name} → ${[...a.spawns].join(', ') || '—'}`);
  for (const g of graphIssues) console.log(`  ${g}`);
  errorCount += graphIssues.filter((g) => g.startsWith('error')).length;
}
console.log(`\n${results.length} agent file(s), ${errorCount} error(s)`);
process.exit(errorCount ? 1 : 0);
