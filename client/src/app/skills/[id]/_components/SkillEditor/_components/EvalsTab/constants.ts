import type { IconName } from "@devdigest/ui";
import type { EvalCaseOutcome } from "@devdigest/shared";
import type { PassingBadgeTone } from "./helpers";

/** Loading placeholder (px). */
export const SKELETON_ROW_HEIGHT = 56;
export const SKELETON_ROWS = 3;

/** Width (px) of the delete-case confirm. */
export const DELETE_MODAL_WIDTH = 440;

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

/** Card status icon: the with-skill result. */
export type CaseIconState = "pass" | "fail" | "flaky" | "error" | "pending" | "never";

export const CASE_ICON_LOOK: Readonly<Record<CaseIconState, { icon: IconName; color: string }>> = {
  pass: { icon: "CheckCircle", color: "var(--ok)" },
  fail: { icon: "XCircle", color: "var(--crit)" },
  flaky: { icon: "Activity", color: "var(--warn)" },
  error: { icon: "AlertTriangle", color: "var(--crit)" },
  pending: { icon: "Clock", color: "var(--text-muted)" },
  never: { icon: "Dot", color: "var(--text-muted)" },
};

export const CASE_ICON_SIZE = 15;

/** Header "P / T passing" badge colours per tone. */
export const PASSING_BADGE_LOOK: Readonly<Record<PassingBadgeTone, { color: string; bg: string }>> = {
  neutral: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  ok: { color: "var(--ok)", bg: "var(--ok-bg)" },
  warn: { color: "var(--warn)", bg: "var(--warn-bg)" },
  crit: { color: "var(--crit)", bg: "var(--crit-bg)" },
};
