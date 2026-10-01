import type { BlastReason, IntentConfidence, RiskKind, RiskSeverity } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Loading-skeleton heights (px) per card. */
export const SKELETON_HEIGHT = { intent: 64, brief: 86, blast: 80, list: 40 } as const;

/** Icon sizes (px): section-level notices vs. inline pills. */
export const ICON_SIZE = { section: 15, inline: 13 } as const;

/** Blast-radius views, in toggle order. */
export const BLAST_VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof BLAST_VIEWS)[number];

/** Icon per blast stat, in display order. */
export const BLAST_STAT_ICON = {
  symbols: "Code",
  callers: "CornerDownRight",
  endpoints: "Globe",
  crons: "Clock",
} as const satisfies Record<string, IconName>;

/** Every blast `reason`; each needs a `reason.<value>` string in blast.json. Local tuple: the client imports only types from shared. */
export const BLAST_REASONS = [
  "index_partial",
  "no_index",
  "flag_off",
  "no_changed_files",
  "index_failed",
  "repo_too_large",
  "no_data",
] as const satisfies readonly BlastReason[];

// Compile-time exhaustiveness: fails when BlastReason gains a value missing from BLAST_REASONS.
type _MissingBlastReason = Exclude<BlastReason, (typeof BLAST_REASONS)[number]>;
const _blastReasonsExhaustive: [_MissingBlastReason] extends [never] ? true : never = true;
void _blastReasonsExhaustive;

/** Degraded reasons a resync can fix (flag_off / repo_too_large it cannot). */
export const RESYNC_REASONS: readonly BlastReason[] = ["index_partial", "index_failed", "no_index", "no_data"];

/** Callers drawn in the SVG graph; the rest collapse into "+N more". */
export const GRAPH_MAX_CALLERS = 8;

/** SVG layout in viewBox units. */
export const GRAPH = { width: 520, rowHeight: 26, pad: 8, symX: 200, callerX: 260, labelGap: 6 } as const;

/** Badge colours for a brief whose intent is out of date. */
export const STALE_COLOR = { c: "var(--warn)", bg: "var(--warn-bg)" } as const;

export const RISK_ICON: Record<RiskKind, IconName> = {
  security: "Shield",
  db_migration: "Database",
  breaking_api: "AlertTriangle",
  perf: "Zap",
  deps: "Boxes",
};

/** Severity → text / background CSS vars (colour is on the pill icon only; the word stays as visually hidden text). */
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

/** Confidence levels worth flagging with a badge; `high` is the unremarkable default. */
export const CONFIDENCE_BADGE_LEVELS: readonly IntentConfidence[] = ["low", "medium"];

/** Runs newer than the shown brief that warrant a notice. */
export const NEWER_RUN_STATUSES = ["running", "failed", "cancelled"] as const;
export type NewerRunStatus = (typeof NEWER_RUN_STATUSES)[number];
