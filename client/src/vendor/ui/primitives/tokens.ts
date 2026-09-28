import type { Severity as FindingSeverity, FindingCategory } from "@devdigest/shared";
import { type IconName } from "../icons";

/**
 * Severity levels the design system can render: every finding severity from
 * `@devdigest/shared`, plus `INFO`, which only UI surfaces use (log lines,
 * neutral notices) and no finding ever carries. A documented superset rather
 * than a copy — see docs/adr/0008-ui-types-from-shared.md. Anything typed as the
 * shared `Severity` is assignable here without a cast.
 */
export type Severity = FindingSeverity | "INFO";

/** Finding category — the `@devdigest/shared` union, not a redeclaration. */
export type Category = FindingCategory;

export const SEV: Record<
  Severity,
  { c: string; bg: string; icon: IconName; label: string }
> = {
  CRITICAL: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon", label: "Critical" },
  WARNING: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle", label: "Warning" },
  SUGGESTION: { c: "var(--sugg)", bg: "var(--sugg-bg)", icon: "Lightbulb", label: "Suggestion" },
  INFO: { c: "var(--info)", bg: "var(--info-bg)", icon: "Info", label: "Info" },
};

/**
 * The one severity order: worst first. Sort, rank and "render in this order"
 * all derive from it. `INFO` is last; a list of shared-contract severities can
 * use it as-is (the extra member simply never matches).
 */
export const SEVERITY_ORDER: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];

/** Sort weight per severity, lower = worse = first. Derived from `SEVERITY_ORDER`. */
export const SEVERITY_RANK = Object.fromEntries(SEVERITY_ORDER.map((sev, i) => [sev, i])) as Record<
  Severity,
  number
>;

/** Comparator for `Array.prototype.sort`: worst severity first. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export const CAT: Record<Category, { icon: IconName; label: string }> = {
  bug: { icon: "Bug", label: "bug" },
  security: { icon: "Shield", label: "security" },
  perf: { icon: "Zap", label: "perf" },
  style: { icon: "Code", label: "style" },
  test: { icon: "FlaskConical", label: "test" },
};

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  kind?: "primary" | "secondary" | "tertiary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconRight?: IconName;
  active?: boolean;
  full?: boolean;
  /** Shows a spinning indicator and disables the button while a task runs. */
  loading?: boolean;
  children?: React.ReactNode;
}
