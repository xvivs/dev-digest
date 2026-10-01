import type { IconName } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";

export interface VerdictMeta {
  /** Foreground colour token. */
  c: string;
  /** Tinted background token. */
  bg: string;
  icon: IconName;
  /** Resolves under `prReview.verdict.*` (banner title) and `prReview.verdict.badge.*` (compact badge). */
  labelKey: "requestChanges" | "approve" | "comment";
}

/**
 * Per-verdict visual meta — the ONE verdict colour source on the PR screen.
 * The run accordion's header badge reads `.c` from here too, so a verdict can
 * no longer render in two colours on one page.
 */
export const VERDICT_META = {
  request_changes: {
    c: "var(--crit)",
    bg: "var(--crit-bg)",
    icon: "XCircle",
    labelKey: "requestChanges",
  },
  approve: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle", labelKey: "approve" },
  comment: { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare", labelKey: "comment" },
} as const satisfies Record<Verdict, VerdictMeta>;

/** Score ring (px) and verdict icon size (px). */
export const SCORE_SIZE = 52;
export const SCORE_STROKE = 5;
export const VERDICT_ICON_SIZE = 22;
