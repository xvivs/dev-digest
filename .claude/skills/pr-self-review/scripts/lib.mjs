// pr-self-review: shared primitives for self-review.mjs and gate-hook.mjs.
//
// Everything that decides "which code was reviewed" lives here, so the hook and
// the skill can never compute the diff differently. Routing (file → lens →
// skills) is also here: it is the single source of truth, references/routing.md
// only explains it.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_BASE = 'origin/main';
export const PACKAGES = ['client', 'server', 'reviewer-core', 'e2e'];
export const LARGE_DIFF = { files: 40, lines: 3000 };

export function git(root, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

export function repoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

export function stateDir(root) {
  return join(root, '.devdigest', 'self-review');
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

// The reviewed code: committed changes of this branch only. Staged, unstaged
// and untracked files are not pushed, so they are not reviewed either.
export function branchDiff(root, base = DEFAULT_BASE) {
  let mergeBase;
  try {
    mergeBase = git(root, ['merge-base', base, 'HEAD']).trim();
  } catch {
    throw new Error(`немає merge-base з ${base}. Зроби: git fetch origin main`);
  }
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const patch = git(root, ['diff', '--binary', '--no-color', '--no-ext-diff', `${mergeBase}...HEAD`]);
  return { base, mergeBase, head, patch, diffHash: sha256(patch) };
}

export function changedFiles(root, mergeBase) {
  const out = git(root, ['diff', '--name-status', '-M', '--no-color', `${mergeBase}...HEAD`]);
  const numstat = git(root, ['diff', '--numstat', '-M', '--no-color', `${mergeBase}...HEAD`]);
  const lines = new Map();
  for (const row of numstat.split('\n').filter(Boolean)) {
    const [add, del, ...rest] = row.split('\t');
    const path = rest.at(-1);
    const binary = add === '-';
    lines.set(path, { added: binary ? 0 : Number(add), deleted: binary ? 0 : Number(del), binary });
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const parts = row.split('\t');
      const status = parts[0][0]; // A M D R C T
      const path = parts.at(-1);
      const from = status === 'R' || status === 'C' ? parts[1] : undefined;
      return { path, from, status, ...(lines.get(path) ?? { added: 0, deleted: 0, binary: false }) };
    });
}

// Files the deterministic checks read from disk. A dirty file here would make
// typecheck/tests judge code that is not the code being pushed.
export function dirtyPackageFiles(root) {
  const out = git(root, ['status', '--porcelain', '--untracked-files=all']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((row) => row.slice(3).split(' -> ').at(-1))
    .filter((path) => PACKAGES.some((pkg) => path.startsWith(`${pkg}/`)))
    .filter((path) => !path.endsWith('.md'))
    .filter((path) => !/(^|\/)node_modules(\/|$)/.test(path)); // a symlinked node_modules is not matched by `node_modules/`
}

export function readAtHead(root, path) {
  try {
    return git(root, ['show', `HEAD:${path}`]);
  } catch {
    return undefined;
  }
}

export function readAt(root, rev, path) {
  try {
    return git(root, ['show', `${rev}:${path}`]);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Routing: file → lens → skills

export const LENSES = {
  'client-arch': { blocking: true, pkg: 'client' },
  'client-tests': { blocking: true, pkg: 'client' },
  'server-arch': { blocking: true, pkg: 'server' },
  'server-tech': { blocking: true, pkg: 'server' },
  'core-purity': { blocking: true, pkg: 'reviewer-core' },
  security: { blocking: true, pkg: null },
  'ts-advisory': { blocking: false, pkg: null },
  'react-perf': { blocking: false, pkg: 'client' },
};

// Skills whose own scale is used 1:1. Everything else is capped (see capSeverity).
const SCALED_SKILLS = new Set(['onion-architecture', 'frontend-architecture', 'react-best-practices', 'core-purity']);

const EXCLUDED = [
  (p) => p.endsWith('.md'),
  (p) => /(^|\/)pnpm-lock\.yaml$/.test(p),
  (p) => p.startsWith('server/src/db/migrations/'),
  (p) => /\/vendor\/shared\//.test(p), // deterministic drift check only
  (p) => /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|pdf|zip)$/i.test(p),
];

const isCode = (p) => /\.(ts|tsx|mts|cts)$/.test(p);
const isTest = (p) => /\.test\.(ts|tsx)$/.test(p) || p.startsWith('client/src/test/');
const importsFrom = (content, mod) =>
  new RegExp(`from\\s+['"]${mod.replace(/[/.]/g, '\\$&')}(/[^'"]*)?['"]`).test(content);

const SECURITY_PATHS = [
  /^server\/src\/modules\/[^/]+\/routes(\.[^/]+)?\.ts$/,
  /^server\/src\/modules\/[^/]+\/routes\//,
  /^server\/src\/adapters\/(auth|secrets|github|git|llm)\//,
  /^server\/src\/(app|server)\.ts$/,
  /^server\/src\/platform\/config\.ts$/,
  /^client\/src\/lib\/api\.ts$/,
  /^reviewer-core\/src\/prompt\.ts$/, // prompt-injection fencing lives here
];
const SECURITY_CONTENT = /dangerouslySetInnerHTML|innerHTML|react-markdown|child_process|execFile|spawn\(|eval\(|new Function\(/;

/**
 * Returns [{ lens, skills[] }] for one changed file. `content` is the file at HEAD.
 * `full` enables advisory lenses.
 */
export function routeFile(path, content, { full = false } = {}) {
  if (EXCLUDED.some((rule) => rule(path)) || !isCode(path) || content === undefined) return [];
  const routes = [];
  const add = (lens, skills) => routes.push({ lens, skills });
  const zod = importsFrom(content, 'zod');

  if (path.startsWith('client/')) {
    if (isTest(path)) {
      add('client-tests', ['react-testing-library']);
    } else if (path.startsWith('client/src/')) {
      add('client-arch', ['frontend-architecture', 'react-best-practices', 'next-best-practices', ...(zod ? ['zod'] : [])]);
      if (full && path.endsWith('.tsx')) add('react-perf', ['vercel:react-best-practices']);
    }
  }

  if (path.startsWith('server/src/')) {
    if (/^server\/src\/(modules|platform|adapters)\//.test(path)) add('server-arch', ['onion-architecture']);
    const tech = [];
    if (importsFrom(content, 'fastify') || /\/routes(\.[^/]+)?\.ts$|\/routes\//.test(path) || /^server\/src\/(app|server)\.ts$/.test(path))
      tech.push('fastify-best-practices');
    if (importsFrom(content, 'drizzle-orm') || path.startsWith('server/src/db/') || /repository/.test(path))
      tech.push('drizzle-orm-patterns');
    if (path.startsWith('server/src/db/schema/')) tech.push('postgresql-table-design');
    if (zod) tech.push('zod');
    if (tech.length) add('server-tech', tech);
  }

  if (path.startsWith('reviewer-core/src/') && !isTest(path)) {
    add('core-purity', ['core-purity', ...(zod ? ['zod'] : [])]);
  }

  if (SECURITY_PATHS.some((re) => re.test(path)) || SECURITY_CONTENT.test(content)) add('security', ['security']);
  if (full) add('ts-advisory', ['typescript-expert']);
  return routes;
}

// Normalizes each skill's own scale to the shared one (spec §3.5).
export function capSeverity(finding) {
  const sev = String(finding.severity ?? '').toUpperCase();
  const lens = LENSES[finding.lens];
  if (lens && !lens.blocking) return sev === 'CRITICAL' ? 'HIGH' : sev;
  if (sev !== 'CRITICAL') return sev;
  const confident = String(finding.confidence ?? '').toUpperCase() === 'HIGH';
  if (finding.skill === 'security') return confident ? 'CRITICAL' : 'HIGH';
  if (finding.skill === 'zod') return confident && /^parse-/.test(finding.rule ?? '') ? 'CRITICAL' : 'HIGH';
  if (SCALED_SKILLS.has(finding.skill)) return 'CRITICAL';
  return 'HIGH';
}

// Everything a lens's verdict depends on besides the file itself. If any of it
// changes, cached findings for that lens are stale.
export function lensRulesHash(root, lens, skills, skillDir) {
  const parts = [lens, readFileSafe(join(skillDir, 'references', 'lens-prompts.md'))];
  for (const skill of [...skills].sort()) {
    parts.push(skill, readFileSafe(join(root, '.claude', 'skills', skill, 'SKILL.md')));
  }
  const pkg = LENSES[lens]?.pkg;
  if (pkg) {
    parts.push(readFileSafe(join(root, pkg, 'AGENTS.md')), readFileSafe(join(root, pkg, 'INSIGHTS.md')));
  }
  return sha256(parts.join('\u0000'));
}

export function readFileSafe(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}
