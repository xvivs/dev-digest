import type { IconName } from "@devdigest/ui";

/** Timeline badge outcome. Each key resolves under `prReview.runStatus.*`. */
export type OutcomeKey = "running" | "error" | "cancelled" | "rejected" | "reviewed" | "approved";

/** Outcome → badge colours + icon. The one colour table for the timeline badge. */
export const OUTCOME_META = {
  running: { color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" },
  error: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" },
  cancelled: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" },
  rejected: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" },
  reviewed: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" },
  approved: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
} as const satisfies Record<OutcomeKey, { color: string; bg: string; icon: IconName }>;

/** Length a commit sha is shortened to in a commit marker row. */
export const SHORT_SHA_LENGTH = 7;
