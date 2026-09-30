import type {
  BlastRadius,
  ReviewRecord,
  RiskSeverity,
  RunSummary,
  Verdict,
} from "@devdigest/shared";
import { NEWER_RUN_STATUSES, RISK_SEVERITY_COLOR, type NewerRunStatus } from "./constants";

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

export function riskTone(severity: RiskSeverity): { c: string; bg: string } {
  return RISK_SEVERITY_COLOR[severity];
}
