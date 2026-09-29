import type { IconName } from "@devdigest/ui";
import type { EvalCaseOutcome } from "@devdigest/shared";

/** Badge per case outcome. The label and glyph carry the meaning; colour only reinforces it. */
export const OUTCOME_LOOK: Readonly<Record<EvalCaseOutcome, { color: string; bg: string; icon: IconName }>> = {
  caught: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  regressed: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "TrendingDown" },
  pass_both: { color: "var(--text-secondary)", bg: "var(--bg-hover)", icon: "Check" },
  fail_both: { color: "var(--text-secondary)", bg: "var(--bg-hover)", icon: "X" },
  flaky: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "Activity" },
  pending: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Clock" },
  error: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertTriangle" },
};

/** A per-case Δunexpected above this gets its own badge (ADR 0017 counts > 1 as noise-worthy). */
export const UNEXPECTED_BADGE_MIN = 0.05;
