#!/usr/bin/env node
// pr-self-review: the deterministic half of the skill.
//
//   node self-review.mjs collect  [--base <ref>] [--full | --checks-only] [--no-incremental] [--no-fetch]
//   node self-review.mjs check    --run <runDir>
//   node self-review.mjs merge    --run <runDir>
//   node self-review.mjs finalize --run <runDir> [--tokens <n>]
//
// collect  → runDir/collect.json: diff, routing, cache hits. Exit 3 on a dirty tree.
//            `--checks-only` records `level: "checks"` and routes zero files to
//            any lens (only the deterministic `check` runs); otherwise `level`
//            is `"full"`. `--checks-only` with `--full` is an error. A full run
//            is incremental when an earlier full PASS of this branch is an
//            ancestor of HEAD: lenses get only files changed since it (ADR 0015).
// check    → runDir/checks.json: typecheck, unit tests, arch:check, static rules.
// merge    → runDir/merged.json: lens outputs + cache, capped, deduped; prints the skeptic queue.
// finalize → stamp, cache, refuted.jsonl, report.md, pr-body.md; prints the report.
//
// The LLM parts (lenses, skeptic) are run by the orchestrating agent between
// merge and finalize. The verdict is computed here, never by a model.

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE,
  LARGE_DIFF,
  LENSES,
  PACKAGES,
  branchDiff,
  capSeverity,
  changedFiles,
  currentBranch,
  dirtyPackageFiles,
  findIncrementalBase,
  git,
  lensRulesHash,
  pathsChangedBetween,
  readAt,
  readAtHead,
  readJson,
  repoRoot,
  routeFile,
  sha256,
  stampLevel,
  stateDir,
} from './lib.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const CMD_TIMEOUT_MS = 10 * 60 * 1000;

function args() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else opts[key] = rest[++i];
  }
  return { cmd, opts };
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fail(message, code = 1) {
  out({ status: 'error', message });
  process.exit(code);
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function requireRun(opts) {
  if (!opts.run || !existsSync(join(opts.run, 'collect.json'))) fail('потрібен --run <runDir> з collect.json (спершу collect)');
  return { runDir: opts.run, collect: readJson(join(opts.run, 'collect.json')) };
}

// ---------------------------------------------------------------------------

function collect(opts) {
  const startedAt = Date.now();
  const root = repoRoot(process.cwd());
  const base = typeof opts.base === 'string' ? opts.base : DEFAULT_BASE;
  const full = Boolean(opts.full);
  const checksOnly = Boolean(opts['checks-only']);
  if (checksOnly && full) fail('--checks-only і --full не можна разом: обери один режим');
  const warnings = [];

  const dirty = dirtyPackageFiles(root);
  if (dirty.length) {
    out({
      status: 'dirty',
      message:
        'Робоче дерево в пакетах не чисте. Self-review перевіряє закомічений код, а typecheck і тести читають диск. ' +
        'Закоміть зміни або відклади їх WIP-комітом (не bare git stash) і запусти знову.',
      files: dirty,
    });
    process.exit(3);
  }

  if (!opts['no-fetch'] && base === DEFAULT_BASE) {
    try {
      git(root, ['fetch', 'origin', 'main', '--quiet'], { timeout: 30_000 });
    } catch {
      warnings.push('git fetch origin main не вдався: використано локальний origin/main, merge-base може бути застарілим');
    }
  }
  if (base !== DEFAULT_BASE) warnings.push(`base перевизначено на ${base}: hook рахує diff від ${DEFAULT_BASE}, тож цей штамп гейт не відкриє`);

  const diff = branchDiff(root, base);
  const files = changedFiles(root, diff.mergeBase);
  const runDir = join(stateDir(root), 'runs', diff.diffHash);
  const cacheDir = join(stateDir(root), 'cache');
  const branch = currentBranch(root);

  // Incremental full review (ADR 0015): lenses see only files changed since the
  // nearest earlier full PASS on this branch. Checks still run on the whole diff.
  // `--full` asks for more coverage (advisory lenses), so it reviews everything.
  const incremental =
    checksOnly || full || opts['no-incremental'] ? undefined : findIncrementalBase(root, { base, branch, head: diff.head });
  const delta = incremental ? pathsChangedBetween(root, incremental.head, diff.head) : undefined;
  if (incremental)
    warnings.push(
      `інкрементальний прогін: лінзи дивляться лише файли, змінені після full PASS на ${incremental.head.slice(0, 7)} ` +
        `(${incremental.distance} коміт(ів) тому); повний прогін: --no-incremental`,
    );

  const lenses = {};
  const excluded = [];
  const carried = [];
  let anyRoutable = false;
  for (const f of files) {
    if (f.status === 'D') {
      excluded.push({ path: f.path, reason: 'видалено' });
      continue;
    }
    const content = readAtHead(root, f.path);
    const routes = routeFile(f.path, content, { full });
    if (routes.length === 0) {
      excluded.push({ path: f.path, reason: 'поза лінзами' });
      continue;
    }
    anyRoutable = true;
    if (checksOnly) {
      excluded.push({ path: f.path, reason: 'лінзи вимкнено (--checks-only)' });
      continue;
    }
    if (delta && !delta.has(f.path)) {
      carried.push(f.path);
      continue;
    }
    const blob = sha256(content);
    for (const { lens, skills } of routes) {
      const cacheKey = sha256([lens, f.path, blob, lensRulesHash(root, lens, skills, SKILL_DIR)].join('\u0000'));
      const cachePath = join(cacheDir, lens, `${cacheKey}.json`);
      const entry = (lenses[lens] ??= { blocking: LENSES[lens].blocking, skills: [], files: [], cached: [] });
      for (const s of skills) if (!entry.skills.includes(s)) entry.skills.push(s);
      const item = { path: f.path, status: f.status, skills, cacheKey };
      if (existsSync(cachePath)) entry.cached.push(item);
      else entry.files.push(item);
    }
  }

  const totalLines = files.reduce((n, f) => n + f.added + f.deleted, 0);
  const large = files.length > LARGE_DIFF.files || totalLines > LARGE_DIFF.lines;
  if (large && !incremental)
    warnings.push(`великий diff (${files.length} файлів, ${totalLines} рядків): перевіряється повністю, але прогін буде довгим і дорогим`);

  const data = {
    startedAt,
    root,
    branch,
    base,
    mergeBase: diff.mergeBase,
    head: diff.head,
    diffHash: diff.diffHash,
    full,
    level: checksOnly ? 'checks' : 'full',
    empty: diff.patch.length === 0,
    docsOnly: diff.patch.length > 0 && !anyRoutable,
    stats: { files: files.length, lines: totalLines, large },
    files,
    excluded,
    incremental: incremental ? { fromDiffHash: incremental.diffHash, fromHead: incremental.head, carried } : undefined,
    lenses,
    warnings,
  };
  writeJson(join(runDir, 'collect.json'), data);
  out({
    status: 'ok',
    runDir,
    diffHash: diff.diffHash,
    branch: data.branch,
    level: data.level,
    empty: data.empty,
    docsOnly: data.docsOnly,
    stats: data.stats,
    incremental: incremental ? { fromHead: incremental.head, carried: carried.length } : undefined,
    lensesToRun: Object.fromEntries(
      Object.entries(lenses)
        .filter(([, l]) => l.files.length)
        .map(([name, l]) => [name, { blocking: l.blocking, skills: l.skills, files: l.files.map((f) => f.path) }]),
    ),
    fromCache: Object.fromEntries(Object.entries(lenses).map(([name, l]) => [name, l.cached.length])),
    excluded: excluded.length,
    warnings,
  });
}

// ---------------------------------------------------------------------------

function run(cmd, cmdArgs, cwd) {
  return new Promise((resolvePromise) => {
    // pnpm ≥10 may run `pnpm install` before a script when it thinks deps are
    // stale. A gate must never reinstall dependencies behind the user's back.
    const env = { ...process.env, FORCE_COLOR: '0', pnpm_config_verify_deps_before_run: 'false', npm_config_verify_deps_before_run: 'false' };
    const child = spawn(cmd, cmdArgs, { cwd, env });
    let buf = '';
    const onData = (d) => {
      buf += d;
      if (buf.length > 2_000_000) buf = buf.slice(-1_000_000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), CMD_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, output: String(err) });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code: signal ? -1 : code, output: buf + (signal ? `\n[killed: ${signal}, timeout ${CMD_TIMEOUT_MS / 1000}s]` : '') });
    });
  });
}

const tail = (text, n = 40) => text.trimEnd().split('\n').slice(-n).join('\n');

// reviewer-core and e2e are npm packages (package-lock.json), client and server pnpm.
function installHint(root, pkg) {
  return existsSync(join(root, pkg, 'package-lock.json')) ? `cd ${pkg} && npm ci` : `cd ${pkg} && pnpm install --frozen-lockfile`;
}

function packagesToCheck(files) {
  const pkgs = new Set();
  for (const f of files) {
    for (const p of [f.path, f.from].filter(Boolean)) {
      if (p.endsWith('.md')) continue; // docs change no build, no test
      const top = p.split('/')[0];
      if (PACKAGES.includes(top)) pkgs.add(top);
      if (p.startsWith('reviewer-core/')) pkgs.add('server'); // server type-checks reviewer-core source
      if (p.startsWith('server/src/vendor/shared/')) pkgs.add('reviewer-core'); // reviewer-core aliases server's copy
    }
  }
  return [...pkgs];
}

async function check(opts) {
  const { runDir, collect: c } = requireRun(opts);
  const root = c.root;
  const results = [];
  const jobs = [];

  for (const pkg of packagesToCheck(c.files)) {
    const cwd = join(root, pkg);
    if (!existsSync(join(cwd, 'node_modules'))) {
      results.push({ id: `deps:${pkg}`, name: `залежності ${pkg}`, severity: 'CRITICAL', ok: false, detail: `немає ${pkg}/node_modules: ${installHint(root, pkg)}` });
      continue;
    }
    const scripts = readJson(join(cwd, 'package.json'), {}).scripts ?? {};
    const skip = (id, name) => results.push({ id, name, severity: 'CRITICAL', ok: true, skipped: true, detail: `скрипт не визначено в ${pkg}/package.json` });
    if (!scripts.typecheck) skip(`typecheck:${pkg}`, `pnpm typecheck (${pkg})`);
    else jobs.push(run('pnpm', ['typecheck'], cwd).then((r) => ({ id: `typecheck:${pkg}`, name: `pnpm typecheck (${pkg})`, r })));
    if (pkg !== 'e2e')
      jobs.push(
        run('pnpm', ['exec', 'vitest', 'run', '--passWithNoTests', '--exclude', '**/*.it.test.ts', '--exclude', '**/node_modules/**'], cwd).then(
          (r) => ({ id: `unit:${pkg}`, name: `vitest без *.it.test.ts (${pkg})`, r }),
        ),
      );
    if (pkg === 'server' && !scripts['arch:check']) skip('arch:server', 'pnpm arch:check (server)');
    else if (pkg === 'server' && c.files.some((f) => f.path.startsWith('server/') || f.from?.startsWith('server/')))
      jobs.push(run('pnpm', ['arch:check'], cwd).then((r) => ({ id: 'arch:server', name: 'pnpm arch:check (server)', r })));
  }
  for (const { id, name, r } of await Promise.all(jobs)) {
    const pkg = id.split(':')[1];
    const broken = /Cannot find module '[^']*node_modules|ERR_PNPM_|command not found/.test(r.output);
    const hint = broken ? `\nСхоже, залежності ${pkg} зламані або не встановлені: ${installHint(root, pkg)}` : '';
    results.push({ id, name, severity: 'CRITICAL', ok: r.code === 0, detail: r.code === 0 ? undefined : tail(r.output) + hint });
  }

  results.push(...staticChecks(root, c));
  await verifyNewBaseline(root, results);
  writeJson(join(runDir, 'checks.json'), results);
  out({
    status: 'ok',
    failed: results.filter((r) => !r.ok).map((r) => ({ id: r.id, severity: r.severity, name: r.name })),
    passed: results.filter((r) => r.ok && !r.skipped).map((r) => r.id),
    skipped: results.filter((r) => r.skipped).map((r) => `${r.id}: ${r.detail}`),
  });
}

// A baseline created in this branch has no "before" to compare against, so
// regenerate it and require an exact match: a hand-edited or stale baseline
// (one that hides a violation the code no longer has, or lists one it does)
// then fails with the difference instead of asking for a manual check. The
// tree is clean (collect enforces it), so the disk is HEAD.
async function verifyNewBaseline(root, results) {
  const item = results.find((r) => r.id === 'arch-baseline' && r.verify);
  if (!item) return;
  const cwd = join(root, 'server');
  const r = await run('pnpm', ['exec', 'depcruise-baseline', '--config', '.dependency-cruiser.cjs', '-f', '-', 'src'], cwd);
  delete item.verify;
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  const generated = r.code === 0 ? parse(r.output.slice(r.output.indexOf('['))) : undefined;
  const committed = parse(readAtHead(root, 'server/.dependency-cruiser-known-violations.json') ?? '');
  if (!Array.isArray(generated) || !Array.isArray(committed)) {
    item.detail = `не вдалося перегенерувати baseline для порівняння:\n${tail(r.output, 15)}`;
    return;
  }
  const key = (v) => `${v.from} -> ${v.to} [${v.rule?.name}]`;
  const gen = new Set(generated.map(key));
  const com = new Set(committed.map(key));
  const onlyCommitted = [...com].filter((k) => !gen.has(k));
  const onlyGenerated = [...gen].filter((k) => !com.has(k));
  item.ok = onlyCommitted.length === 0 && onlyGenerated.length === 0;
  item.detail = item.ok
    ? undefined
    : [
        ...onlyCommitted.map((k) => `у файлі, але не в згенерованому: ${k}`),
        ...onlyGenerated.map((k) => `згенеровано, але немає у файлі: ${k}`),
        'перегенеруй: cd server && pnpm arch:baseline',
      ].join('\n');
}

function staticChecks(root, c) {
  const results = [];
  const paths = new Set(c.files.flatMap((f) => [f.path, f.from].filter(Boolean)));

  // Vendored @devdigest/shared: server and client copies change together.
  const drift = [];
  for (const p of paths) {
    const m = p.match(/^(server|client)\/src\/vendor\/shared\/(.+)$/);
    if (!m) continue;
    const twin = `${m[1] === 'server' ? 'client' : 'server'}/src/vendor/shared/${m[2]}`;
    if (!paths.has(twin)) drift.push(`${p} змінено, ${twin} ні`);
  }
  results.push({ id: 'vendored-shared', name: 'vendored @devdigest/shared в обох копіях', severity: 'CRITICAL', ok: drift.length === 0, detail: drift.join('\n') || undefined });

  // Migrations are generated by `pnpm db:generate`, never hand-edited.
  const mig = c.files.filter((f) => f.path.startsWith('server/src/db/migrations/') && f.path.endsWith('.sql'));
  const schemaChanged = c.files.some((f) => f.path.startsWith('server/src/db/schema/'));
  const migIssues = [
    ...mig.filter((f) => f.status !== 'A').map((f) => `${f.path}: існуючу міграцію змінено (${f.status})`),
    ...(mig.some((f) => f.status === 'A') && !schemaChanged ? ['нова міграція без зміни server/src/db/schema/**'] : []),
  ];
  results.push({ id: 'migrations', name: 'міграції лише через db:generate', severity: 'CRITICAL', ok: migIssues.length === 0, detail: migIssues.join('\n') || undefined });

  // dependency-cruiser baseline must not grow to hide new violations.
  const baselinePath = 'server/.dependency-cruiser-known-violations.json';
  if (paths.has(baselinePath)) {
    const count = (text) => {
      try {
        const v = JSON.parse(text);
        return Array.isArray(v) ? v.length : Array.isArray(v?.violations) ? v.violations.length : 0;
      } catch {
        return NaN;
      }
    };
    const before = readAt(root, c.mergeBase, baselinePath);
    const after = readAtHead(root, baselinePath);
    if (before === undefined) {
      // Verified in check() by regenerating it — see verifyNewBaseline().
      results.push({ id: 'arch-baseline', name: 'baseline dependency-cruiser = вихід pnpm arch:baseline', severity: 'HIGH', ok: false, verify: baselinePath, detail: `${baselinePath} з'явився в цій гілці: переконайся, що його згенеровано через pnpm arch:baseline, а не написано вручну` });
    } else if (after !== undefined) {
      const grew = count(after) > count(before) || Number.isNaN(count(after));
      results.push({ id: 'arch-baseline', name: 'baseline dependency-cruiser не росте', severity: 'CRITICAL', ok: !grew, detail: grew ? `записів було ${count(before)}, стало ${count(after)}` : undefined });
    }
  }

  // Secrets in added lines.
  const SECRET = [
    /sk-ant-[A-Za-z0-9_-]{20,}/,
    /sk-(proj-)?[A-Za-z0-9]{32,}/,
    /sk-or-v1-[a-f0-9]{32,}/,
    /gh[pousr]_[A-Za-z0-9]{36,}/,
    /github_pat_[A-Za-z0-9_]{40,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  const patch = git(root, ['diff', '--no-color', '-U0', `${c.mergeBase}...HEAD`]);
  const hits = [];
  let file = '';
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ b\//, '');
    else if (line.startsWith('+') && SECRET.some((re) => re.test(line))) hits.push(`${file}: ${line.slice(1, 80).replace(/[A-Za-z0-9_-]{12,}/g, (s) => `${s.slice(0, 6)}…`)}`);
  }
  results.push({ id: 'secrets', name: 'секрети в diff', severity: 'CRITICAL', ok: hits.length === 0, detail: hits.join('\n') || undefined });

  return results;
}

// ---------------------------------------------------------------------------

function normalize(raw, lens, fromCache) {
  const f = {
    lens,
    file: String(raw.file ?? ''),
    line: Number.isFinite(Number(raw.line)) ? Number(raw.line) : 0,
    skill: String(raw.skill ?? ''),
    rule: String(raw.rule ?? ''),
    reportedSeverity: String(raw.reportedSeverity ?? raw.severity ?? 'MEDIUM').toUpperCase(),
    confidence: String(raw.confidence ?? 'MEDIUM').toUpperCase(),
    evidence: String(raw.evidence ?? ''),
    fix: String(raw.fix ?? ''),
    fromCache,
  };
  f.severity = fromCache ? String(raw.severity).toUpperCase() : capSeverity({ ...f, severity: f.reportedSeverity });
  f.id = raw.id && fromCache ? raw.id : `F-${sha256([lens, f.file, f.line, f.rule, f.evidence].join('|')).slice(0, 8)}`;
  if (fromCache && raw.skeptic) f.skeptic = raw.skeptic;
  return f;
}

function merge(opts) {
  const { runDir, collect: c } = requireRun(opts);
  const cacheDir = join(stateDir(c.root), 'cache');
  const lensStatus = {};
  const findings = [];

  for (const [lens, entry] of Object.entries(c.lenses)) {
    for (const item of entry.cached) {
      const cached = readJson(join(cacheDir, lens, `${item.cacheKey}.json`), { findings: [] });
      findings.push(...cached.findings.map((raw) => normalize(raw, lens, true)));
    }
    if (entry.files.length === 0) {
      lensStatus[lens] = { status: 'cached' };
      continue;
    }
    const outPath = join(runDir, `lens-${lens}.json`);
    const result = readJson(outPath, undefined);
    if (!result) {
      lensStatus[lens] = { status: 'failed', error: `немає ${outPath}` };
      continue;
    }
    if (result.status !== 'ok') {
      lensStatus[lens] = { status: 'failed', error: result.error || 'лінза повернула status != ok' };
      continue;
    }
    const reviewed = new Set(result.reviewed ?? []);
    const missing = entry.files.map((f) => f.path).filter((p) => !reviewed.has(p));
    if (missing.length) {
      lensStatus[lens] = { status: 'failed', error: `лінза не підтвердила рев'ю файлів: ${missing.join(', ')}` };
      continue;
    }
    if (!Array.isArray(result.findings)) {
      lensStatus[lens] = { status: 'failed', error: 'findings не масив' };
      continue;
    }
    lensStatus[lens] = { status: 'ok' };
    findings.push(...result.findings.map((raw) => normalize(raw, lens, false)));
  }

  const merged = dedupe(findings);
  // Every fresh CRITICAL goes to the skeptic, including ones deduped behind another
  // finding: otherwise an unverified CRITICAL could land in the cache.
  const skepticQueue = [...new Map(findings.filter((f) => f.severity === 'CRITICAL' && !f.fromCache).map((f) => [f.id, f])).values()];

  writeJson(join(runDir, 'merged.json'), { lensStatus, findings: merged, raw: findings, skepticQueue: skepticQueue.map((f) => f.id) });
  out({
    status: 'ok',
    lensStatus,
    counts: countBy(merged),
    skepticQueue: skepticQueue.map(({ id, file, line, lens, skill, rule, evidence, fix }) => ({ id, file, line, lens, skill, rule, evidence, fix })),
  });
}

// Dedupe the same file:line reported by *different* lenses: the most severe wins,
// the others are kept in `also` and rendered. Distinct rules from one lens stay
// separate rows.
function dedupe(findings) {
  const rows = [];
  for (const f of findings) {
    const i = rows.findIndex((r) => r.file === f.file && r.line === f.line && r.lens !== f.lens && !r.also.some((a) => a.lens === f.lens));
    if (i === -1) {
      rows.push({ ...f, also: [] });
      continue;
    }
    const prev = rows[i];
    if (SEV_ORDER[f.severity] < SEV_ORDER[prev.severity]) rows[i] = { ...f, also: [...prev.also, { lens: prev.lens, rule: prev.rule, severity: prev.severity }] };
    else prev.also.push({ lens: f.lens, rule: f.rule, severity: f.severity });
  }
  return rows.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

function countBy(findings) {
  const n = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) n[f.severity] = (n[f.severity] ?? 0) + 1;
  return n;
}

// ---------------------------------------------------------------------------

function finalize(opts) {
  const { runDir, collect: c } = requireRun(opts);
  const state = stateDir(c.root);
  const checks = readJson(join(runDir, 'checks.json'), undefined);
  const m = readJson(join(runDir, 'merged.json'), c.empty || c.docsOnly ? { lensStatus: {}, findings: [], raw: [], skepticQueue: [] } : undefined);
  const skeptic = readJson(join(runDir, 'skeptic.json'), []);
  const blocking = [];

  if (!checks && !c.empty) blocking.push('детерміновані перевірки не запускались (check)');
  if (!m) fail('немає merged.json: спершу merge');

  for (const r of checks ?? []) if (!r.ok && r.severity === 'CRITICAL') blocking.push(`[${r.id}] ${r.name}`);
  for (const [lens, s] of Object.entries(m.lensStatus)) if (s.status === 'failed') blocking.push(`[lens:${lens}] не відпрацювала: ${s.error}`);

  const verdicts = new Map(skeptic.map((v) => [v.id, v]));
  const refutedLog = join(state, 'refuted.jsonl');
  const unverified = new Set();
  const applySkeptic = (f) => {
    if (!m.skepticQueue.includes(f.id)) return f;
    const v = verdicts.get(f.id);
    if (!v) {
      unverified.add(f.id);
      return f;
    }
    if (v.verdict === 'refuted') {
      mkdirSync(state, { recursive: true });
      appendFileSync(refutedLog, JSON.stringify({ rule: f.rule, skill: f.skill, lens: f.lens, file: f.file, line: f.line, reason: v.reason, at: new Date().toISOString() }) + '\n');
      return { ...f, severity: 'HIGH', skeptic: { verdict: 'refuted', reason: v.reason } };
    }
    return { ...f, skeptic: { verdict: 'confirmed', reason: v.reason } };
  };
  const raw = m.raw.map(applySkeptic);
  const findings = dedupe(raw);
  for (const id of unverified) blocking.push(`[skeptic] CRITICAL ${id} не перевірено skeptic-ом`);
  for (const f of raw) if (f.severity === 'CRITICAL' && !unverified.has(f.id)) blocking.push(`[${f.lens}] ${f.file}:${f.line} ${f.rule} (${f.id})`);

  // Cache per (lens, file): only lenses that finished, only fully verified findings.
  const cacheDir = join(state, 'cache');
  for (const [lens, entry] of Object.entries(c.lenses)) {
    if (m.lensStatus[lens]?.status !== 'ok') continue;
    for (const item of entry.files) {
      const mine = raw.filter((f) => f.lens === lens && f.file === item.path);
      if (mine.some((f) => unverified.has(f.id))) continue;
      writeJson(join(cacheDir, lens, `${item.cacheKey}.json`), { path: item.path, findings: mine });
    }
  }

  const verdict = blocking.length ? 'BLOCK' : 'PASS';
  const counts = countBy(findings);
  const ms = Date.now() - c.startedAt;
  const tokens = opts.tokens ? Number(opts.tokens) : undefined;
  const stamp = {
    diffHash: c.diffHash,
    base: c.base,
    mergeBase: c.mergeBase,
    head: c.head,
    branch: c.branch,
    level: c.level ?? 'full',
    ...(c.incremental ? { incrementalFrom: { diffHash: c.incremental.fromDiffHash, head: c.incremental.fromHead } } : {}),
    verdict,
    criticals: blocking.length,
    blocking,
    counts,
    lenses: Object.fromEntries(Object.entries(m.lensStatus).map(([k, v]) => [k, v.status])),
    at: new Date().toISOString(),
    cost: { ms, tokens },
  };
  // A stamp for an overridden base would never match the hook's diff, so it is not written as a gate key.
  if (c.base === DEFAULT_BASE) {
    const stampPath = join(state, `${c.diffHash}.json`);
    // A checks-only PASS must never overwrite an existing full PASS for the same
    // diff: the full run is strictly stronger (it also ran the lenses) and a
    // later, narrower checks-only run must not throw that verification away.
    const existing = stamp.level === 'checks' ? readJson(stampPath, undefined) : undefined;
    const keepExisting = existing?.verdict === 'PASS' && stampLevel(existing) === 'full';
    if (keepExisting) c.warnings.push('вже є повний PASS для цього diff: checks-only вердикт не перезаписав штамп');
    else writeJson(stampPath, stamp);
  }

  const report = renderReport(c, checks ?? [], findings, m.lensStatus, stamp);
  writeFileSync(join(runDir, 'report.md'), report);
  writeFileSync(join(runDir, 'pr-body.md'), renderPrBody(c, checks ?? [], findings, m.lensStatus, stamp));
  process.stdout.write(report);
  process.exit(verdict === 'PASS' ? 0 : 4);
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function skippedLine(c, checks = []) {
  const parts = ['server/**/*.it.test.ts (потрібен Docker/Postgres)'];
  for (const r of checks.filter((x) => x.skipped)) parts.push(`${r.name}: ${r.detail}`);
  if (c.excluded.length) parts.push(`${c.excluded.length} файлів поза лінзами (видалені, lockfile, міграції, vendored, md, не-TS)`);
  if (c.incremental?.carried.length)
    parts.push(`${c.incremental.carried.length} файлів лінзи не дивились: без змін після full PASS на ${c.incremental.fromHead.slice(0, 7)}`);
  if (c.level === 'checks') parts.push('усі LLM-лінзи пропущено через --checks-only');
  else if (!c.full) parts.push('advisory-лінзи ts-advisory і react-perf (без --full)');
  return parts.join('; ');
}

function renderReport(c, checks, findings, lensStatus, stamp) {
  const lensCount = Object.keys(lensStatus).length;
  const cachedLenses = Object.values(lensStatus).filter((s) => s.status === 'cached').length;
  const cachedFiles = Object.values(c.lenses).reduce((n, l) => n + l.cached.length, 0);
  const lines = [];
  lines.push(
    `Self-review: ${stamp.verdict} (${stamp.criticals} блокуючих; ${stamp.counts.CRITICAL} critical, ${stamp.counts.HIGH} high, ${stamp.counts.MEDIUM} medium)  ` +
      `base=${c.base}@${c.mergeBase.slice(0, 7)}  head=${c.head.slice(0, 7)}  files=${c.stats.files}`,
  );
  lines.push(
    `рівень: ${stamp.level === 'checks' ? 'лише детерміновані перевірки' : 'повний (з лінзами)'}` +
      (c.incremental ? `, інкрементальний від ${c.incremental.fromHead.slice(0, 7)}` : ''),
  );
  lines.push(
    `Час: ${Math.round(stamp.cost.ms / 1000)} с · лінзи: ${lensCount} (${cachedLenses} повністю з кешу, ${cachedFiles} файл-лінз з кешу)` +
      (stamp.cost.tokens ? ` · токени: ~${stamp.cost.tokens}` : ' · токени: не виміряно'),
  );
  if (c.empty) lines.push('', 'Diff гілки порожній: перевіряти нічого.');
  if (c.docsOnly) lines.push('', 'Лише документація або файли поза лінзами: LLM-лінзи не запускались.');
  for (const w of c.warnings) lines.push(`⚠ ${w}`);

  if (stamp.blocking.length) {
    lines.push('', '### Що блокує');
    for (const b of stamp.blocking) lines.push(`- ${b}`);
  }

  const failedChecks = checks.filter((r) => !r.ok);
  if (failedChecks.length) {
    lines.push('', '### Детерміновані перевірки');
    for (const r of failedChecks) {
      lines.push(`- **${r.severity}** ${r.name}`);
      if (r.detail) lines.push('```', r.detail, '```');
    }
  }
  const passedChecks = checks.filter((r) => r.ok && !r.skipped).map((r) => r.id);
  if (passedChecks.length) lines.push('', `Пройшли: ${passedChecks.join(', ')}`);

  if (findings.length) {
    lines.push('', '| Sev | file:line | Лінза / скіл / правило | Що не так | Fix |', '|-----|-----------|------------------------|-----------|-----|');
    for (const f of findings) {
      const sk = f.skeptic ? ` (skeptic: ${f.skeptic.verdict === 'refuted' ? 'спростовано' : 'підтверджено'})` : '';
      const also = f.also?.length ? ` (також: ${f.also.map((a) => `${a.lens} / ${a.rule} ${a.severity}`).join('; ')})` : '';
      lines.push(`| ${f.severity}${sk} | ${cell(f.file)}:${f.line} | ${cell(`${f.lens} / ${f.skill} / ${f.rule}${also}`)} | ${cell(f.evidence)} | ${cell(f.fix)} |`);
    }
  }
  lines.push('', `Пропущено: ${skippedLine(c, checks)}`);
  if (c.base !== DEFAULT_BASE) lines.push(`Штамп не записано: base ${c.base} ≠ ${DEFAULT_BASE}, гейт його не прийме.`);
  return lines.join('\n') + '\n';
}

function renderPrBody(c, checks, findings, lensStatus, stamp) {
  const rest = findings.filter((f) => f.severity !== 'CRITICAL');
  const lines = [
    '### Self-review',
    '',
    `\`${stamp.verdict}\` · diffHash \`${c.diffHash.slice(0, 12)}\` · лінзи: ${Object.keys(lensStatus).join(', ') || 'немає'}`,
  ];
  if (rest.length) {
    lines.push('', 'Не блокує, варто глянути:');
    for (const f of rest) lines.push(`- ${f.severity} \`${f.file}:${f.line}\`: ${f.evidence}`);
  }
  lines.push('', `Пропущено: ${skippedLine(c, checks)}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

const { cmd, opts } = args();
try {
  if (cmd === 'collect') collect(opts);
  else if (cmd === 'check') await check(opts);
  else if (cmd === 'merge') merge(opts);
  else if (cmd === 'finalize') finalize(opts);
  else fail('usage: self-review.mjs <collect|check|merge|finalize> [...]');
} catch (err) {
  fail(err.message);
}
