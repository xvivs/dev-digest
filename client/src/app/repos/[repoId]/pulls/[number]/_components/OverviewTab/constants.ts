import type { IntentConfidence, RiskKind, RiskSeverity } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Confidence levels, strongest first (also the badge order). */
export const CONFIDENCE_ORDER: readonly IntentConfidence[] = ["high", "medium", "low"];

/** Blast-radius views, in toggle order. */
export const BLAST_VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof BLAST_VIEWS)[number];

/** Callers drawn in the SVG graph; the rest collapse into "+N more". */
export const GRAPH_MAX_CALLERS = 8;

export const RISK_ICON: Record<RiskKind, IconName> = {
  security: "Shield",
  db_migration: "Database",
  breaking_api: "AlertTriangle",
  perf: "Zap",
  deps: "Boxes",
};

/** Severity → text / background CSS vars (the label is always rendered too, never colour alone). */
export const RISK_SEVERITY_COLOR: Record<RiskSeverity, { c: string; bg: string }> = {
  high: { c: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  low: { c: "var(--info)", bg: "var(--info-bg)" },
};

export const CONFIDENCE_COLOR: Record<IntentConfidence, { c: string; bg: string }> = {
  high: { c: "var(--ok, var(--info))", bg: "var(--info-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  low: { c: "var(--text-muted)", bg: "var(--bg-hover)" },
};

/** Runs newer than the shown brief that warrant a notice. */
export const NEWER_RUN_STATUSES = ["running", "failed", "cancelled"] as const;
export type NewerRunStatus = (typeof NEWER_RUN_STATUSES)[number];
