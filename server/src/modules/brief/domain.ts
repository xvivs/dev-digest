/**
 * DOMAIN — pure brief rules (ADR 0022): link classification (D6), confidence
 * cap (D7), deterministic risk pre-pass and ref grounding (D9). No I/O, no
 * clock, no runtime zod: everything here is testable with plain values.
 */
import type { IntentConfidence, IntentSource, Risk, UnresolvedLink } from '@devdigest/shared';
import {
  DEP_LOCKFILES,
  DEP_MANIFESTS,
  DESTRUCTIVE_SQL_RE,
  DOC_EXTENSIONS,
  MAX_DOC_PATH_LEN,
  MAX_LINKED_DOCS,
  MAX_LINKED_ISSUES,
  MAX_UNRESOLVED_LINKS,
  MIGRATION_PATH_RES,
  MIN_DESCRIPTION_CHARS,
  REQUIREMENTS_RE,
  RICH_DESCRIPTION_CHARS,
  RULE_REFS_MAX,
  SPEC_LIKE_RE,
} from './constants.js';

// ============================================================ links (D6)

export interface RepoName {
  owner: string;
  name: string;
}

export interface LinkedDoc {
  /** Repo-relative path, read at head_sha. */
  path: string;
  /** The ref in a blob URL (ignored for the read, kept for the source record). */
  urlRef: string | null;
}

export interface LinkPlan {
  docs: LinkedDoc[];
  issues: number[];
  unresolved: UnresolvedLink[];
}

const EXT_GROUP = DOC_EXTENSIONS.join('|');
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/gi;
const PATH_RE = new RegExp(
  `(?<![\\w@:/.\\-])(?:/|\\.{1,2}/)?[^\\s()<>[\\]"'\`,;]{0,${MAX_DOC_PATH_LEN}}?\\.(?:${EXT_GROUP})(?![\\w\\-])`,
  'gi',
);
const CLOSING_ISSUE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
const DOC_EXT_RE = new RegExp(`\\.(?:${EXT_GROUP})$`, 'i');
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Lexical guard: a path taken from PR text may only be a plain repo-relative path. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes('\0') || path.startsWith('-') || path.startsWith('/')) return false;
  return !path.split('/').some((seg) => seg === '..');
}

function trimUrlTail(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

function sameRepo(a: RepoName, owner: string, name: string): boolean {
  return a.owner.toLowerCase() === owner.toLowerCase() && a.name.toLowerCase() === name.toLowerCase();
}

type Found =
  | { at: number; kind: 'doc'; doc: LinkedDoc }
  | { at: number; kind: 'issue'; n: number }
  | { at: number; kind: 'unresolved'; link: UnresolvedLink };

function classifyUrl(raw: string, at: number, repo: RepoName): Found | undefined {
  let u: URL;
  try {
    u = new URL(trimUrlTail(raw));
  } catch {
    return undefined;
  }
  // Query and fragment may carry tokens; never store or log them.
  const clean = `${u.origin}${u.pathname}`;
  if (!GITHUB_HOSTS.has(u.hostname.toLowerCase())) {
    return { at, kind: 'unresolved', link: { url: clean, reason: 'external_host' } };
  }
  const seg = u.pathname.split('/').filter((s) => s.length > 0);
  const [owner, name, verb, ...rest] = seg;
  if (!owner || !name || !sameRepo(repo, owner, name)) {
    return { at, kind: 'unresolved', link: { url: clean, reason: 'other_repo' } };
  }
  if (verb === 'issues' && rest[0] && /^\d+$/.test(rest[0])) {
    return { at, kind: 'issue', n: Number(rest[0]) };
  }
  if (verb === 'blob' && rest.length >= 2) {
    const [urlRef, ...pathParts] = rest;
    let path: string;
    try {
      path = decodeURIComponent(pathParts.join('/'));
    } catch {
      return { at, kind: 'unresolved', link: { url: clean, reason: 'unsafe_path' } };
    }
    if (!isSafeRelativePath(path)) {
      return { at, kind: 'unresolved', link: { url: clean, reason: 'unsafe_path' } };
    }
    if (!DOC_EXT_RE.test(path)) {
      return { at, kind: 'unresolved', link: { url: clean, reason: 'not_a_doc' } };
    }
    return { at, kind: 'doc', doc: { path, urlRef: urlRef ?? null } };
  }
  return { at, kind: 'unresolved', link: { url: clean, reason: 'not_a_doc' } };
}

/**
 * Classify every link in a PR body (D6). Extraction runs on the FULL body. A URL
 * is never fetched: same-repo docs are read at head_sha, same-repo issues go
 * through the GitHub API, everything else is recorded as unresolved.
 */
export function planLinks(body: string | null | undefined, repo: RepoName): LinkPlan {
  const text = body ?? '';
  const found: Found[] = [];

  for (const m of text.matchAll(CLOSING_ISSUE_RE)) {
    found.push({ at: m.index ?? 0, kind: 'issue', n: Number(m[1]) });
  }
  for (const m of text.matchAll(URL_RE)) {
    const f = classifyUrl(m[0], m.index ?? 0, repo);
    if (f) found.push(f);
  }
  // Relative paths: scan with URLs blanked out so a URL's path is not matched twice.
  const withoutUrls = text.replace(URL_RE, (u) => ' '.repeat(u.length));
  for (const m of withoutUrls.matchAll(PATH_RE)) {
    const token = m[0];
    const at = m.index ?? 0;
    if (!isSafeRelativePath(token)) {
      found.push({ at, kind: 'unresolved', link: { url: token, reason: 'unsafe_path' } });
      continue;
    }
    found.push({ at, kind: 'doc', doc: { path: token.replace(/^(\.\/)+/, ''), urlRef: null } });
  }
  found.sort((a, b) => a.at - b.at);

  const docs: LinkedDoc[] = [];
  const issues: number[] = [];
  const unresolved: UnresolvedLink[] = [];
  const seen = new Set<string>();
  const addUnresolved = (link: UnresolvedLink) => {
    const key = `${link.reason}|${link.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    unresolved.push(link);
  };
  for (const f of found) {
    if (f.kind === 'unresolved') addUnresolved(f.link);
    else if (f.kind === 'issue') {
      if (issues.includes(f.n)) continue;
      if (issues.length >= MAX_LINKED_ISSUES) addUnresolved({ url: `#${f.n}`, reason: 'limit_reached' });
      else issues.push(f.n);
    } else {
      if (docs.some((d) => d.path === f.doc.path)) continue;
      if (docs.length >= MAX_LINKED_DOCS) addUnresolved({ url: f.doc.path, reason: 'limit_reached' });
      else docs.push(f.doc);
    }
  }
  return { docs, issues, unresolved: unresolved.slice(0, MAX_UNRESOLVED_LINKS) };
}

// ============================================================ confidence (D7)

const CONFIDENCE_RANK: Record<IntentConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * The body minus what carries no signal: HTML comments (PR templates),
 * markdown headings, checkbox lines and whitespace.
 */
export function meaningfulLength(body: string | null | undefined): number {
  return (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line) && !/^\s*[-*+]\s*\[[ xX]\]/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export interface ConfidenceSignals {
  descriptionChars: number;
  hasResolvedDoc: boolean;
  hasIssueBody: boolean;
  unresolved: readonly UnresolvedLink[];
}

/** The highest confidence the inputs justify; the model can only go lower. */
export function confidenceCap(s: ConfidenceSignals): IntentConfidence {
  let cap: IntentConfidence;
  if (s.hasResolvedDoc || s.hasIssueBody || s.descriptionChars >= RICH_DESCRIPTION_CHARS) cap = 'high';
  else if (s.descriptionChars >= MIN_DESCRIPTION_CHARS) cap = 'medium';
  else cap = 'low';
  if (s.unresolved.some((l) => SPEC_LIKE_RE.test(l.url)) && CONFIDENCE_RANK[cap] > CONFIDENCE_RANK.medium) {
    cap = 'medium';
  }
  return cap;
}

/** min(model, cap) on low < medium < high. */
export function capConfidence(model: IntentConfidence, cap: IntentConfidence): IntentConfidence {
  return CONFIDENCE_RANK[model] <= CONFIDENCE_RANK[cap] ? model : cap;
}

export interface SourceInputs {
  title: string;
  descriptionChars: number;
  issueRef: string | null;
  issueChars: number;
  docs: readonly { ref: string; chars: number }[];
  branch: string;
  commitChars: number;
  pathChars: number;
  hasDiffstat: boolean;
}

/** What fed the derivation, in a stable order. `ref` is a path/issue ref, never PR prose. */
export function buildIntentSources(i: SourceInputs): IntentSource[] {
  const out: IntentSource[] = [{ kind: 'title', ref: null, chars: i.title.length }];
  if (i.descriptionChars > 0) out.push({ kind: 'description', ref: null, chars: i.descriptionChars });
  if (i.issueRef) out.push({ kind: 'issue', ref: i.issueRef, chars: i.issueChars });
  for (const d of i.docs) out.push({ kind: 'spec', ref: d.ref, chars: d.chars });
  if (i.branch) out.push({ kind: 'branch', ref: null, chars: i.branch.length });
  if (i.commitChars > 0) out.push({ kind: 'commits', ref: null, chars: i.commitChars });
  if (i.pathChars > 0) out.push({ kind: 'paths', ref: null, chars: i.pathChars });
  if (i.hasDiffstat) out.push({ kind: 'diffstat', ref: null, chars: 0 });
  return out;
}

// ============================================================ risks (D9)

export interface RiskFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** New-side line range of a hunk (1-based, inclusive). */
export interface LineRange {
  start: number;
  end: number;
}

export interface GroundingFile {
  path: string;
  /** null = no patch (binary / oversized): only the bare `path` form is accepted. */
  ranges: LineRange[] | null;
}

const SEVERITY_RANK: Record<Risk['severity'], number> = { low: 0, medium: 1, high: 2 };

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Added patch lines (`+…`, not the `+++` header). */
function addedLines(patch: string | null): string[] {
  if (!patch) return [];
  return patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
}

/** The deterministic pre-pass: `deps` and `db_migration`. Always `origin: 'rule'`. */
export function ruleRisks(files: readonly RiskFile[]): Risk[] {
  const risks: Risk[] = [];

  const manifests: string[] = [];
  const locks: string[] = [];
  for (const f of files) {
    const base = basename(f.path);
    if ((DEP_MANIFESTS as readonly string[]).includes(base) || REQUIREMENTS_RE.test(base)) manifests.push(f.path);
    else if ((DEP_LOCKFILES as readonly string[]).includes(base)) locks.push(f.path);
  }
  if (manifests.length + locks.length > 0) {
    const manifestChanged = manifests.length > 0;
    risks.push({
      kind: 'deps',
      title: manifestChanged ? 'Dependency manifest changed' : 'Lockfile changed',
      explanation: manifestChanged
        ? `Dependencies may have been added, removed or bumped: ${manifests.join(', ')}.`
        : `Only lockfiles changed (${locks.join(', ')}); resolved versions may have moved.`,
      severity: manifestChanged ? 'medium' : 'low',
      file_refs: [...manifests, ...locks].slice(0, RULE_REFS_MAX),
      origin: 'rule',
    });
  }

  const migrations = files.filter((f) => MIGRATION_PATH_RES.some((re) => re.test(f.path)));
  if (migrations.length > 0) {
    const destructive = migrations.some((f) => addedLines(f.patch).some((l) => DESTRUCTIVE_SQL_RE.test(l)));
    risks.push({
      kind: 'db_migration',
      title: destructive ? 'Destructive database migration' : 'Database migration',
      explanation: destructive
        ? 'A migration drops, truncates or renames schema objects; data loss or an incompatible rollout is possible.'
        : 'The PR changes database migrations; check ordering, locking and rollback.',
      severity: destructive ? 'high' : 'medium',
      file_refs: migrations.map((f) => f.path).slice(0, RULE_REFS_MAX),
      origin: 'rule',
    });
  }
  return risks;
}

const REF_RE = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/;

/**
 * Keep only refs that point at a changed file (and, with a line or range, at a
 * changed new-side hunk). Forms: `path`, `path:N`, `path:N-M`; a leading `./`
 * is stripped. Returns the kept refs (deduplicated) and how many were dropped.
 */
export function groundRiskRefs(
  refs: readonly string[],
  changed: readonly GroundingFile[],
): { kept: string[]; dropped: number } {
  const byPath = new Map(changed.map((f) => [f.path, f]));
  const kept: string[] = [];
  let dropped = 0;
  for (const raw of refs) {
    const m = raw.trim().replace(/^(\.\/)+/, '').match(REF_RE);
    const file = m?.[1] ? byPath.get(m[1]) : undefined;
    if (!m || !file) {
      dropped += 1;
      continue;
    }
    const from = m[2] === undefined ? undefined : Number(m[2]);
    if (from === undefined) {
      if (!kept.includes(file.path)) kept.push(file.path);
      continue;
    }
    const to = m[3] === undefined ? from : Number(m[3]);
    const hit = to >= from && file.ranges !== null && file.ranges.some((r) => from <= r.end && to >= r.start);
    if (!hit) {
      dropped += 1;
      continue;
    }
    const ref = m[3] === undefined ? `${file.path}:${from}` : `${file.path}:${from}-${to}`;
    if (!kept.includes(ref)) kept.push(ref);
  }
  return { kept, dropped };
}

/** A risk as the model proposed it (already clamped): kind/title/explanation/severity/refs. */
export type ModelRisk = Omit<Risk, 'origin'>;

export interface FinalizedRisks {
  risks: Risk[];
  droppedRefs: number;
}

/**
 * Ground the model's refs, drop model risks left with none, and merge a model
 * risk into the rule risk of the same kind (rule severity is the floor, refs
 * are unioned, the model explanation is kept).
 */
export function finalizeRisks(
  rules: readonly Risk[],
  modelRisks: readonly ModelRisk[],
  changed: readonly GroundingFile[],
): FinalizedRisks {
  const out: Risk[] = rules.map((r) => ({ ...r, file_refs: [...r.file_refs] }));
  let droppedRefs = 0;
  for (const mr of modelRisks) {
    const grounded = groundRiskRefs(mr.file_refs, changed);
    droppedRefs += grounded.dropped;
    if (grounded.kept.length === 0) continue;
    const rule = out.find((r) => r.origin === 'rule' && r.kind === mr.kind);
    if (rule) {
      if (SEVERITY_RANK[mr.severity] > SEVERITY_RANK[rule.severity]) rule.severity = mr.severity;
      rule.explanation = mr.explanation;
      for (const ref of grounded.kept) if (!rule.file_refs.includes(ref)) rule.file_refs.push(ref);
      continue;
    }
    out.push({ ...mr, file_refs: grounded.kept, origin: 'model' });
  }
  return { risks: out, droppedRefs };
}
