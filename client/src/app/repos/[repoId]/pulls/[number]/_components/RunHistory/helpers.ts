/**
 * Timeline-specific pure helpers. `formatTokenTotal` is separate from
 * RunTraceDrawer/helpers.ts's `formatTokens` on purpose — that one renders the
 * sidebar's "12k→1.5k" shape; the timeline row needs a single running total,
 * "9,119 tok".
 */
import type { PrCommit, RunSummary } from "@devdigest/shared";
import type { OutcomeKey } from "./constants";

/** Total tokens for the timeline row, e.g. "9,119 tok". Null when the run has no token counts. */
export function formatTokenTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null && tokensOut == null) return null;
  const total = (tokensIn ?? 0) + (tokensOut ?? 0);
  return `${new Intl.NumberFormat("en-US").format(total)} tok`;
}

/**
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected", never a green "done". A settled run
 * is classified by the denormalised blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */
export function outcomeOf(run: Pick<RunSummary, "status" | "blockers" | "findings_count">): OutcomeKey {
  if (run.status === "running") return "running";
  if (run.status === "failed") return "error";
  if (run.status === "cancelled") return "cancelled";
  if ((run.blockers ?? 0) > 0) return "rejected";
  if ((run.findings_count ?? 0) > 0) return "reviewed";
  return "approved";
}

/** Epoch ms for sorting; unparseable / missing timestamps sort last. */
export function tsOf(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

export type TimelineItem =
  | { kind: "run"; ts: number; run: RunSummary }
  | { kind: "commit"; ts: number; commit: PrCommit };

/** Runs and commits interleaved, newest first. */
export function buildTimeline(runs: readonly RunSummary[], commits: readonly PrCommit[]): TimelineItem[] {
  return [
    ...runs.map((run): TimelineItem => ({ kind: "run", ts: tsOf(run.ran_at), run })),
    ...commits.map((commit): TimelineItem => ({ kind: "commit", ts: tsOf(commit.committed_at), commit })),
  ].sort((a, b) => b.ts - a.ts);
}
