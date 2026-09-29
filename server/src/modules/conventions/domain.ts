/**
 * DOMAIN — the core ring of the `conventions` module (specs/02-conventions.md).
 * Pure: no I/O, no container, no Drizzle, no Fastify, no runtime zod. Holds the
 * entity shapes the service works with, the SAMPLE / VERIFY / PERSIST rules as
 * plain functions, and the module's errors.
 */
import type {
  ConventionCategory,
  ConventionOrigin,
  ConventionStatus,
  CostSource,
  SkillSource,
  SkillType,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { sha256Hex } from '../_shared/hash.js';
import { containsInvisibleChars } from '../_shared/text-hygiene.js';
import {
  CONFIDENCE_WEIGHTS,
  MAX_QUOTES,
  PER_GROUP_LIMIT,
  QUOTE_MIN_NON_WS,
  RULE_MAX,
  RULE_MIN,
  SINGLE_FILE_CONFIDENCE_CAP,
  SNIPPET_MAX_LINES,
  SUPPORT_SATURATION,
} from './constants.js';

// ============================================================ entities

export type ScanStatus = 'running' | 'done' | 'failed';

export interface ScanRecord {
  id: string;
  workspaceId: string;
  repoId: string;
  status: ScanStatus;
  jobId: string | null;
  attempt: number;
  commitSha: string | null;
  sampleFileCount: number;
  foundCount: number;
  verifiedCount: number;
  droppedCount: number;
  relocatedCount: number;
  matchedPriorCount: number;
  duplicateCount: number;
  retryCount: number;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  costSource: CostSource | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ConventionEvidence {
  path: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

/** The stable per-repo identity. Decisions live here, never on scan rows. */
export interface ConventionRecord {
  id: string;
  workspaceId: string;
  repoId: string;
  fingerprint: string;
  category: ConventionCategory;
  origin: ConventionOrigin;
  rule: string;
  originalRule: string;
  status: ConventionStatus;
  editedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  lastSeenScanId: string | null;
}

export interface ObservationView {
  evidence: ConventionEvidence[];
  supportCount: number;
  counterCount: number;
  reviewHits: number;
  confidence: number;
}

/** An identity joined with its last observation, that scan's SHA and its skills (read model). */
export interface ConventionView extends ConventionRecord {
  observation: ObservationView | null;
  lastSeenCommitSha: string | null;
  skills: { id: string; name: string }[];
}

export interface ConventionsPageData {
  lastScan: ScanRecord | null;
  runningScan: ScanRecord | null;
  latestDoneScan: ScanRecord | null;
  candidates: ConventionView[];
}

export interface RepoInfo {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

/** A recurring review finding fed to the model as a hint (D13). Never evidence. */
export interface ScanSignal {
  id: string;
  category: string;
  title: string;
  prCount: number;
  files: string[];
}

/** A decided identity sent to the model under a short id (`P1..Pn`). */
export interface PriorIdentity {
  ref: string;
  id: string;
  status: ConventionStatus;
  category: ConventionCategory;
  rule: string;
}

/** A skill created from conventions, as the service returns it. */
export interface CreatedSkill {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  version: number;
  evidenceFiles: string[] | null;
  needsVetting: boolean;
  updatedAt: Date;
}

/** One quote as the model proposes it (mirrors the LLM schema, see `llm-schema.ts`). */
export interface ProposedQuote {
  path: string;
  quote: string;
  line_hint: number | null;
}

/** One candidate as the model proposes it. Untrusted until VERIFY. */
export interface ProposedCandidate {
  rule: string;
  evidence: ProposedQuote[];
  counter_example: ProposedQuote | null;
  origin: ConventionOrigin;
  signal_id: string | null;
  prior_ref: string | null;
  category: ConventionCategory;
  llm_confidence: number;
}

// ============================================================ errors

export class ScanRunningError extends AppError {
  constructor(scanId: string) {
    super('scan_running', 'A conventions scan is already running for this repo', 409, { scan_id: scanId });
  }
}

export class RepoNotClonedError extends AppError {
  constructor() {
    super('repo_not_cloned', 'The repo has no clone on disk. Re-import or resync it first.', 409);
  }
}

export class RepoNotIndexedError extends AppError {
  constructor(status: string) {
    super('repo_not_indexed', 'The repo is not indexed yet. Run indexing in Project Context first.', 409, {
      index_status: status,
    });
  }
}

export class ConventionNotAcceptedError extends AppError {
  constructor(ids: string[]) {
    super('convention_not_accepted', 'Only accepted conventions can go into a skill', 422, {
      convention_ids: ids,
    });
  }
}

export class InvalidConventionRuleError extends AppError {
  constructor(reason: string) {
    super('invalid_rule', `Rule rejected: ${reason}`, 422);
  }
}

export class AgentSkillsBudgetExceededError extends AppError {
  constructor(agentId: string, budgetBytes: number, limitBytes: number) {
    super(
      'agent_skills_budget_exceeded',
      `Enabled skills of agent ${agentId} would total ${budgetBytes} bytes, exceeding the ${limitBytes}-byte budget`,
      422,
      { agent_id: agentId, budget_bytes: budgetBytes, limit_bytes: limitBytes },
    );
  }
}

export class SnippetTooLongError extends AppError {
  constructor(lines: number) {
    super(
      'snippet_too_long',
      `A code block in the body has ${lines} lines; extracted skills allow at most ${SNIPPET_MAX_LINES}`,
      422,
      { lines, limit: SNIPPET_MAX_LINES },
    );
  }
}

/**
 * An attempt failed for a reason a fresh attempt can fix (HEAD moved, deadline).
 * Status 503 is deliberate: JobRunner's `withRetry` retries only errors whose
 * `statusCode` is 429/5xx, so this is how a scan opts into the job's retries.
 * It never reaches HTTP.
 */
export class ScanTransientError extends AppError {
  constructor(code: 'head_moved' | 'scan_deadline_exceeded', message: string) {
    super(code, message, 503);
  }
}

/** A newer attempt owns the scan row; this one must write nothing (AC-19). */
export class StaleAttemptError extends AppError {
  constructor() {
    super('stale_attempt', 'A newer attempt owns this scan', 409);
  }
}

// ============================================================ small helpers

const utf8 = new TextEncoder();

export function byteLength(text: string): number {
  return utf8.encode(text).length;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function nonWsLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

export function parseScanJobPayload(payload: unknown): { scanId: string } {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { scanId?: unknown }).scanId === 'string'
  ) {
    return { scanId: (payload as { scanId: string }).scanId };
  }
  throw new Error('conventions.extract: malformed job payload');
}

/** Stored error text: bounded, one line. */
export function errorMessage(err: unknown): string {
  const raw =
    err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500) || 'unknown error';
}

// ============================================================ identity

/** Case, punctuation and whitespace do not make a different rule. */
export function normalizeRule(rule: string): string {
  return rule
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Stable identity key of a rule within a repo. Computed once, from the original rule. */
export function fingerprint(rule: string): string {
  return sha256Hex(normalizeRule(rule));
}

// ============================================================ SAMPLE (AC-10)

/** Directory group: the first two directory segments (`src/modules`), `.` for root files. */
export function dirKey(path: string): string {
  const dirs = path.split('/').slice(0, -1);
  return dirs.slice(0, 2).join('/') || '.';
}

/**
 * Forced files first (deduped), then ranked files round-robin across directory
 * groups (in order of each group's best rank), at most `perGroup` per group,
 * until `maxCode` paths are chosen.
 */
export function stratifySample(
  ranked: readonly string[],
  forced: readonly string[],
  maxCode: number,
  perGroup: number = PER_GROUP_LIMIT,
): string[] {
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (const p of forced) {
    if (chosen.length >= maxCode) break;
    if (seen.has(p)) continue;
    seen.add(p);
    chosen.push(p);
  }

  const groups = new Map<string, string[]>();
  for (const p of ranked) {
    if (seen.has(p)) continue;
    seen.add(p);
    const key = dirKey(p);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }

  const lists = [...groups.values()];
  for (let round = 0; round < perGroup && chosen.length < maxCode; round += 1) {
    for (const list of lists) {
      if (chosen.length >= maxCode) break;
      const p = list[round];
      if (p !== undefined) chosen.push(p);
    }
  }
  return chosen;
}

export type SampleKind = 'code' | 'config';

/** One file as it reaches the prompt. `lines` are the real lines that were sent. */
export interface SampleFile {
  path: string;
  kind: SampleKind;
  lines: string[];
  /** Rendered with the gutter and, when cut, the truncation marker. */
  text: string;
  bytes: number;
  /** Last sent line when a limit cut the file, else null. */
  truncatedAt: number | null;
}

function gutter(lineNo: number, width: number): string {
  return `${String(lineNo).padStart(width)}| `;
}

/**
 * Cut `content` to `maxLines` lines and `maxBytes` bytes (at a line boundary)
 * and render it with a 1-based gutter (`  23| code`, G5). A cut file ends with
 * `… truncated at line N` (G9). Returns null for an empty or binary file.
 */
export function renderSampleFile(
  path: string,
  kind: SampleKind,
  content: string,
  maxLines: number,
  maxBytes: number,
): SampleFile | null {
  if (content.includes('\0')) return null;
  const all = content.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  if (all.every((l) => l.trim() === '')) return null;

  const lines: string[] = [];
  let bytes = 0;
  for (const line of all) {
    if (lines.length >= maxLines) break;
    const size = byteLength(line) + 1;
    if (bytes + size > maxBytes) break;
    lines.push(line);
    bytes += size;
  }
  if (lines.length === 0) return null;

  const truncatedAt = lines.length < all.length ? lines.length : null;
  const width = Math.max(4, String(lines.length).length);
  const body = lines.map((l, i) => `${gutter(i + 1, width)}${l}`).join('\n');
  const text = truncatedAt !== null ? `${body}\n… truncated at line ${truncatedAt}` : body;
  return { path, kind, lines, text, bytes: byteLength(text), truncatedAt };
}

/**
 * Keep files in order while the rendered total stays within `maxBytes`. A file
 * that does not fit is skipped (a smaller later one may still fit). The kept
 * files are the sent set (Trap 6).
 */
export function packSample(files: readonly SampleFile[], maxBytes: number): { sent: SampleFile[]; cut: string[] } {
  const sent: SampleFile[] = [];
  const cut: string[] = [];
  let total = 0;
  for (const f of files) {
    if (total + f.bytes > maxBytes) {
      cut.push(f.path);
      continue;
    }
    sent.push(f);
    total += f.bytes;
  }
  return { sent, cut };
}

// ============================================================ VERIFY (AC-14..16)

/**
 * Normalise a path the model cited (G6): leading `./` and a trailing `:N` or
 * `:N-M` go; an exact member of `sent` wins; otherwise a UNIQUE `/`-suffix of
 * one sent path matches; anything else (ambiguous, absolute, `..`) is null.
 */
export function normalizeEvidencePath(raw: string, sent: readonly string[]): string | null {
  if (raw.includes('\0')) return null;
  let p = raw.trim().replace(/\\/g, '/');
  p = p.replace(/:\d+(?:-\d+)?$/, '');
  while (p.startsWith('./')) p = p.slice(2);
  if (p.length === 0 || p.startsWith('/') || p.split('/').includes('..')) return null;
  if (sent.includes(p)) return p;
  const matches = sent.filter((s) => s.endsWith(`/${p}`));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

const GUTTER_RE = /^\s*\d+\|\s?/;

/** Remove a line-number gutter the model copied into a quote (G5) — only when every non-blank line has one. */
export function stripGutter(quote: string): string {
  const lines = quote.split(/\r?\n/);
  const nonBlank = lines.filter((l) => l.trim() !== '');
  if (nonBlank.length === 0 || !nonBlank.every((l) => GUTTER_RE.test(l))) return quote;
  return lines.map((l) => l.replace(GUTTER_RE, '')).join('\n');
}

interface NormalizedText {
  text: string;
  /** 1-based source line of each UTF-16 unit of `text`. */
  lineOf: number[];
}

/** `collapse`: every whitespace run → one space. `strip`: whitespace removed. */
function normalizeWs(lines: readonly string[], mode: 'collapse' | 'strip'): NormalizedText {
  let text = '';
  const lineOf: number[] = [];
  let pendingSpace = false;
  lines.forEach((line, i) => {
    if (i > 0) pendingSpace = true;
    for (const ch of line) {
      if (/\s/u.test(ch)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && mode === 'collapse' && text.length > 0) {
        text += ' ';
        lineOf.push(i + 1);
      }
      pendingSpace = false;
      text += ch;
      for (let k = 0; k < ch.length; k += 1) lineOf.push(i + 1);
    }
  });
  return { text, lineOf };
}

function findAll(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (needle.length === 0) return out;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    out.push(idx);
    idx = haystack.indexOf(needle, idx + 1);
  }
  return out;
}

export interface RelocatedQuote {
  lineStart: number;
  lineEnd: number;
  /** The quote needed whitespace normalisation, or its lines differ from `line_hint`. */
  relocated: boolean;
}

/**
 * Find `quote` in `lines` by whitespace-normalised search (collapse runs, then
 * ignore whitespace entirely) and return the real line range. With several
 * matches the one nearest `lineHint` wins, else the first (G7). Null when the
 * quote is not in the file or has fewer than 8 non-whitespace chars (G3).
 */
export function relocateQuote(
  lines: readonly string[],
  rawQuote: string,
  lineHint: number | null,
): RelocatedQuote | null {
  const quote = stripGutter(rawQuote).trim();
  if (nonWsLength(quote) < QUOTE_MIN_NON_WS) return null;
  const quoteLines = quote.split(/\r?\n/);

  let ranges: { start: number; end: number }[] = [];
  for (const mode of ['collapse', 'strip'] as const) {
    const hay = normalizeWs(lines, mode);
    const needle = normalizeWs(quoteLines, mode).text;
    ranges = findAll(hay.text, needle).map((idx) => ({
      start: hay.lineOf[idx] ?? 1,
      end: hay.lineOf[idx + needle.length - 1] ?? 1,
    }));
    if (ranges.length > 0) break;
  }
  const first = ranges[0];
  if (!first) return null;

  let best = first;
  if (lineHint !== null) {
    for (const r of ranges) {
      if (Math.abs(r.start - lineHint) < Math.abs(best.start - lineHint)) best = r;
    }
  }
  const exact = lines.join('\n').includes(quote);
  const relocated = !exact || (lineHint !== null && lineHint !== best.start);
  return { lineStart: best.start, lineEnd: best.end, relocated };
}

/** The real file lines of a range, capped at `SNIPPET_MAX_LINES`. */
export function snippetFor(
  lines: readonly string[],
  lineStart: number,
  lineEnd: number,
): Omit<ConventionEvidence, 'path'> {
  const end = Math.min(lineEnd, lineStart + SNIPPET_MAX_LINES - 1);
  return { lineStart, lineEnd: end, snippet: lines.slice(lineStart - 1, end).join('\n') };
}

/** AC-16: `clamp(0.45·llm + 0.45·min(support,3)/3 + 0.10·signal − 0.30·counter)`, ≤ 0.59 below 2 files. */
export function computeConfidence(input: {
  llm: number;
  support: number;
  signal: boolean;
  counter: boolean;
}): number {
  const w = CONFIDENCE_WEIGHTS;
  const raw =
    w.llm * clamp01(input.llm) +
    (w.support * Math.min(input.support, SUPPORT_SATURATION)) / SUPPORT_SATURATION +
    (input.signal ? w.signal : 0) -
    (input.counter ? w.counter : 0);
  const capped = input.support < 2 ? Math.min(raw, SINGLE_FILE_CONFIDENCE_CAP) : raw;
  return round3(clamp01(capped));
}

export interface VerifiedCandidate {
  rule: string;
  category: ConventionCategory;
  origin: ConventionOrigin;
  priorRef: string | null;
  signalId: string | null;
  llmConfidence: number;
  evidence: ConventionEvidence[];
  support: number;
  counter: boolean;
  reviewHits: number;
  relocated: boolean;
  confidence: number;
}

export interface VerifyResult {
  verified: VerifiedCandidate[];
  found: number;
  dropped: number;
  relocated: number;
}

function verifyQuote(
  q: ProposedQuote,
  files: ReadonlyMap<string, readonly string[]>,
  sentPaths: readonly string[],
): { evidence: ConventionEvidence; relocated: boolean } | null {
  const path = normalizeEvidencePath(q.path, sentPaths);
  if (path === null) return null;
  const lines = files.get(path);
  if (!lines) return null;
  const hit = relocateQuote(lines, q.quote, q.line_hint);
  if (!hit) return null;
  const snip = snippetFor(lines, hit.lineStart, hit.lineEnd);
  return { evidence: { ...snip, path }, relocated: hit.relocated };
}

function distinctPaths(evidence: readonly ConventionEvidence[]): number {
  return new Set(evidence.map((e) => e.path)).size;
}

const evidenceKey = (e: ConventionEvidence) => `${e.path}:${e.lineStart}-${e.lineEnd}`;

/**
 * VERIFY every proposed candidate against the citeable files (the code files of
 * the sent set). The stored snippet is always the real file text, never the
 * model's. `signal_id` / `prior_ref` survive only when they name a sent id.
 */
export function verifyCandidates(input: {
  candidates: readonly ProposedCandidate[];
  files: ReadonlyMap<string, readonly string[]>;
  signals: ReadonlyMap<string, ScanSignal>;
  priorRefs: ReadonlySet<string>;
}): VerifyResult {
  const sentPaths = [...input.files.keys()];
  const verified: VerifiedCandidate[] = [];
  let relocated = 0;

  for (const c of input.candidates) {
    const rule = c.rule.trim();
    if (rule.length < RULE_MIN || rule.length > RULE_MAX || containsInvisibleChars(rule)) continue;

    const evidence: ConventionEvidence[] = [];
    let anyRelocated = false;
    for (const q of c.evidence.slice(0, MAX_QUOTES)) {
      const v = verifyQuote(q, input.files, sentPaths);
      if (!v) continue;
      if (evidence.some((e) => evidenceKey(e) === evidenceKey(v.evidence))) continue;
      evidence.push(v.evidence);
      anyRelocated ||= v.relocated;
    }
    if (evidence.length === 0) continue;

    const counter = c.counter_example !== null && verifyQuote(c.counter_example, input.files, sentPaths) !== null;
    const signal = c.signal_id !== null ? input.signals.get(c.signal_id) : undefined;
    const support = distinctPaths(evidence);
    if (anyRelocated) relocated += 1;
    verified.push({
      rule,
      category: c.category,
      // review_history needs a real signal behind it.
      origin: signal ? c.origin : 'code',
      priorRef: c.prior_ref !== null && input.priorRefs.has(c.prior_ref) ? c.prior_ref : null,
      signalId: signal ? signal.id : null,
      llmConfidence: clamp01(c.llm_confidence),
      evidence,
      support,
      counter,
      reviewHits: signal ? signal.prCount : 0,
      relocated: anyRelocated,
      confidence: computeConfidence({ llm: c.llm_confidence, support, signal: !!signal, counter }),
    });
  }

  return {
    verified,
    found: input.candidates.length,
    dropped: input.candidates.length - verified.length,
    relocated,
  };
}

// ============================================================ PERSIST (AC-20, AC-20a)

/** One observation ready to persist: an existing identity id, or a new one by fingerprint. */
export interface MergedObservation {
  existingId: string | null;
  fingerprint: string;
  rule: string;
  category: ConventionCategory;
  origin: ConventionOrigin;
  evidence: ConventionEvidence[];
  supportCount: number;
  counterCount: number;
  reviewHits: number;
  llmConfidence: number;
  confidence: number;
  relocated: boolean;
}

export interface MergeResult {
  observations: MergedObservation[];
  duplicateCount: number;
  matchedPriorCount: number;
}

/**
 * Identity ← validated `prior_ref` ?? exact fingerprint ?? new (AC-20). Two
 * candidates resolving to one identity merge (G1): the higher confidence keeps
 * its rule, evidence is unioned (dedup by path+lines, cap 3), support and
 * confidence are recomputed, `duplicateCount` +1. Output keys are unique, so
 * the `(scan_id, convention_id)` key never conflicts.
 */
export function resolveAndMerge(
  verified: readonly VerifiedCandidate[],
  priorByRef: ReadonlyMap<string, string>,
  idByFingerprint: ReadonlyMap<string, string>,
): MergeResult {
  const byKey = new Map<string, MergedObservation & { signal: boolean }>();
  let duplicateCount = 0;

  for (const v of verified) {
    const fp = fingerprint(v.rule);
    const existingId = (v.priorRef !== null ? priorByRef.get(v.priorRef) : undefined) ?? idByFingerprint.get(fp) ?? null;
    const key = existingId !== null ? `id:${existingId}` : `fp:${fp}`;
    const incoming = {
      existingId,
      fingerprint: fp,
      rule: v.rule,
      category: v.category,
      origin: v.origin,
      evidence: v.evidence,
      supportCount: v.support,
      counterCount: v.counter ? 1 : 0,
      reviewHits: v.reviewHits,
      llmConfidence: v.llmConfidence,
      confidence: v.confidence,
      relocated: v.relocated,
      signal: v.signalId !== null,
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, incoming);
      continue;
    }

    duplicateCount += 1;
    const [winner, loser] = incoming.confidence > prev.confidence ? [incoming, prev] : [prev, incoming];
    const evidence: ConventionEvidence[] = [];
    for (const e of [...winner.evidence, ...loser.evidence]) {
      if (evidence.length >= MAX_QUOTES) break;
      if (!evidence.some((x) => evidenceKey(x) === evidenceKey(e))) evidence.push(e);
    }
    const supportCount = distinctPaths(evidence);
    const signal = winner.signal || loser.signal;
    const counter = winner.counterCount > 0 || loser.counterCount > 0;
    byKey.set(key, {
      ...winner,
      evidence,
      supportCount,
      counterCount: counter ? 1 : 0,
      reviewHits: Math.max(winner.reviewHits, loser.reviewHits),
      relocated: winner.relocated || loser.relocated,
      signal,
      confidence: computeConfidence({ llm: winner.llmConfidence, support: supportCount, signal, counter }),
    });
  }

  const observations = [...byKey.values()].map(({ signal: _signal, ...o }) => o);
  return {
    observations,
    duplicateCount,
    matchedPriorCount: observations.filter((o) => o.existingId !== null).length,
  };
}

// ============================================================ reads (AC-4)

const STATUS_ORDER: Record<ConventionStatus, number> = { pending: 0, accepted: 1, rejected: 2 };

/** Status (pending, accepted, rejected) → confidence desc → created_at desc (G12). */
export function sortCandidates<T extends Pick<ConventionView, 'status' | 'observation' | 'createdAt'>>(
  views: readonly T[],
): T[] {
  return [...views].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (b.observation?.confidence ?? 0) - (a.observation?.confidence ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// ============================================================ decisions (AC-5)

export interface ConventionPatch {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
}

export interface ConventionWrite {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
  editedAt?: Date;
  decidedAt?: Date | null;
}

/** Validate a user-edited rule: trimmed, 8..300 chars, no invisible characters. */
export function normalizeEditedRule(raw: string): string {
  const rule = raw.trim();
  if (rule.length === 0) throw new InvalidConventionRuleError('empty');
  if (rule.length < RULE_MIN || rule.length > RULE_MAX) {
    throw new InvalidConventionRuleError(`must be ${RULE_MIN}..${RULE_MAX} characters`);
  }
  if (containsInvisibleChars(rule)) throw new InvalidConventionRuleError('contains invisible characters');
  return rule;
}

/**
 * The write a PATCH turns into. A changed rule or category stamps `edited_at`;
 * a changed status stamps `decided_at` (cleared on a return to pending). The
 * fingerprint never changes: identity is the original rule.
 */
export function planConventionUpdate(current: ConventionRecord, patch: ConventionPatch, now: Date): ConventionWrite {
  const write: ConventionWrite = {};
  if (patch.rule !== undefined) {
    const rule = normalizeEditedRule(patch.rule);
    if (rule !== current.rule) {
      write.rule = rule;
      write.editedAt = now;
    }
  }
  if (patch.category !== undefined && patch.category !== current.category) {
    write.category = patch.category;
    write.editedAt = now;
  }
  if (patch.status !== undefined && patch.status !== current.status) {
    write.status = patch.status;
    write.decidedAt = patch.status === 'pending' ? null : now;
  }
  return write;
}

// ============================================================ skill creation (AC-24..28)

/** Assert every chosen convention is accepted (AC-25). */
export function assertAllAccepted(rows: readonly Pick<ConventionRecord, 'id' | 'status'>[]): void {
  const bad = rows.filter((r) => r.status !== 'accepted').map((r) => r.id);
  if (bad.length > 0) throw new ConventionNotAcceptedError(bad);
}

/** Lines of the longest fenced code block (``` or ~~~) in a markdown body. */
export function maxFencedBlockLines(body: string): number {
  let open: { ch: string; len: number } | null = null;
  let count = 0;
  let max = 0;
  for (const line of body.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      if (fence?.[1]) {
        open = { ch: fence[1][0] ?? '`', len: fence[1].length };
        count = 0;
      }
      continue;
    }
    const closes =
      fence?.[1] !== undefined &&
      fence[1][0] === open.ch &&
      fence[1].length >= open.len &&
      (fence[2] ?? '').trim() === '';
    if (closes) {
      max = Math.max(max, count);
      open = null;
    } else {
      count += 1;
    }
  }
  if (open) max = Math.max(max, count);
  return max;
}

/** ADR 0016 §3: a snippet in an extracted skill body is at most 12 lines. */
export function assertSnippetsWithinCap(body: string): void {
  const lines = maxFencedBlockLines(body);
  if (lines > SNIPPET_MAX_LINES) throw new SnippetTooLongError(lines);
}

/** Distinct evidence paths of the chosen conventions, sorted (`skills.evidence_files`). */
export function evidenceFilesOf(evidence: readonly Pick<ConventionEvidence, 'path'>[]): string[] {
  return [...new Set(evidence.map((e) => e.path))].sort();
}

/** A valid skill-name slug from free text (repo name): matches `SKILL_NAME_PATTERN`. */
export function slugifySkillName(raw: string, maxLength = 64): string {
  const slug = raw
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  // [a-z0-9-] only, no edge hyphens → starts with [a-z0-9]; pad to the 2-char minimum.
  if (slug.length >= 2) return slug;
  return slug.length === 1 ? `repo-${slug}` : 'repo';
}

/** Default modal name `<repo-slug>-conventions`, always a valid slug. */
export function defaultConventionsSkillName(repoName: string): string {
  const suffix = '-conventions';
  return `${slugifySkillName(repoName, 64 - suffix.length)}${suffix}`;
}
