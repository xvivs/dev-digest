import type {
  BlastReason,
  BlastRadius,
  IntentConfidence,
  DownstreamImpact,
  ReviewRecord,
  RunSummary,
  Verdict,
} from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import {
  CONFIDENCE_BADGE_LEVELS,
  GRAPH,
  GRAPH_MAX_CALLERS,
  NEWER_RUN_STATUSES,
  RESYNC_REASONS,
  type NewerRunStatus,
} from "./constants";

export interface LatestBrief {
  run: RunSummary;
  review: ReviewRecord;
  verdict: Verdict;
  /** Status of a run newer than the shown one that is running/failed/cancelled. */
  newerRun: NewerRunStatus | null;
}

const ranAt = (r: RunSummary): number => (r.ran_at ? Date.parse(r.ran_at) || 0 : 0);

/**
 * The newest finished run that has a persisted review, plus the status of any
 * newer run that is not done (so the UI can say the brief may be out of date).
 * A null verdict falls back to `comment`, the banner's own default.
 */
export function selectLatestBrief(
  runs: readonly RunSummary[],
  reviews: readonly ReviewRecord[],
): LatestBrief | null {
  const byNewest = [...runs].sort((a, b) => ranAt(b) - ranAt(a));
  for (const run of byNewest) {
    if (run.status !== "done") continue;
    const review = reviews.find((rv) => rv.run_id === run.run_id);
    if (!review) continue;
    const newer = byNewest.find(
      (r) =>
        ranAt(r) > ranAt(run) && (NEWER_RUN_STATUSES as readonly (string | null)[]).includes(r.status),
    );
    return {
      run,
      review,
      verdict: review.verdict ?? "comment",
      newerRun: (newer?.status as NewerRunStatus | undefined) ?? null,
    };
  }
  return null;
}

/** The confidence badge is shown only when confidence is below `high`. */
export function shouldShowConfidenceBadge(confidence: IntentConfidence): boolean {
  return CONFIDENCE_BADGE_LEVELS.includes(confidence);
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Token counts as two short strings, or null when the run recorded neither. */
export function formatTokenPair(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): { input: string; output: string } | null {
  if (tokensIn == null && tokensOut == null) return null;
  return {
    input: tokensIn == null ? "—" : compact(tokensIn),
    output: tokensOut == null ? "—" : compact(tokensOut),
  };
}

function compactUpper(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Design-style token line `8.2K→1.3K` (in→out), or null when the run recorded neither. */
export function formatTokenArrow(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null && tokensOut == null) return null;
  const part = (n: number | null | undefined) => (n == null ? "—" : compactUpper(n));
  return `${part(tokensIn)}→${part(tokensOut)}`;
}

export interface BlastStats {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

export function blastStats(blast: BlastRadius | null | undefined): BlastStats {
  if (!blast) return { symbols: 0, callers: 0, endpoints: 0, crons: 0 };
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of blast.downstream) {
    callers += d.callers.length;
    d.endpoints_affected.forEach((e) => endpoints.add(e));
    d.crons_affected.forEach((c) => crons.add(c));
  }
  return { symbols: blast.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}

/** True when no changed symbol has a caller (including zero changed symbols). */
export function hasNoCallers(blast: BlastRadius | null | undefined): boolean {
  return blastStats(blast).callers === 0;
}

/** GitHub deep-link to a caller's line at the indexed sha; null (render plain text) when the repo or sha is unknown. */
export function blastCallerHref(
  repoFullName: string | null | undefined,
  sourceSha: string | null | undefined,
  file: string,
  line: number,
): string | null {
  if (!repoFullName || !sourceSha) return null;
  return githubBlobUrl(repoFullName, sourceSha, file, line);
}

/** A Resync only helps a degraded answer whose reason a fresh index run can fix. */
export function canResyncBlast(status: string, reason: BlastReason | null | undefined): boolean {
  return status === "degraded" && !!reason && RESYNC_REASONS.includes(reason);
}

export interface TextSegment {
  text: string;
  code: boolean;
}

/**
 * Split on backticks into plain and code segments. Text only: the caller
 * renders each as a JSX text node (no markdown, no HTML). An unmatched trailing
 * backtick is kept as literal text.
 */
export function splitInlineCode(input: string): TextSegment[] {
  const parts = input.split("`");
  const segments: TextSegment[] = [];
  parts.forEach((text, i) => {
    const isCode = i % 2 === 1;
    const unmatchedTail = isCode && i === parts.length - 1;
    if (unmatchedTail) {
      segments.push({ text: `\`${text}`, code: false });
    } else if (text) {
      segments.push({ text, code: isCode });
    }
  });
  return segments;
}

export interface BlastGraphLayout {
  /** viewBox height. */
  height: number;
  symbols: { label: string; y: number }[];
  /** Drawn callers (at most GRAPH_MAX_CALLERS); `fromY` is the y of the symbol that calls it. */
  callers: { label: string; file: string; line: number; y: number; fromY: number }[];
  /** Callers beyond GRAPH_MAX_CALLERS that are not drawn. */
  hidden: number;
}

/** Pure layout of the blast graph in viewBox units; null when there is no caller to draw. */
export function blastGraphLayout(downstream: readonly DownstreamImpact[]): BlastGraphLayout | null {
  const edges = downstream.flatMap((d, si) => d.callers.map((c) => ({ from: si, file: c.file, line: c.line, label: `${c.name}:${c.line}` })));
  if (edges.length === 0) return null;
  const shown = edges.slice(0, GRAPH_MAX_CALLERS);
  const rows = Math.max(downstream.length, shown.length);
  const rowY = (i: number) => GRAPH.pad + i * GRAPH.rowHeight + GRAPH.rowHeight / 2;
  return {
    height: rows * GRAPH.rowHeight + GRAPH.pad * 2,
    symbols: downstream.map((d, i) => ({ label: d.symbol, y: rowY(i) })),
    callers: shown.map((e, i) => ({ label: e.label, file: e.file, line: e.line, y: rowY(i), fromY: rowY(e.from) })),
    hidden: edges.length - shown.length,
  };
}
