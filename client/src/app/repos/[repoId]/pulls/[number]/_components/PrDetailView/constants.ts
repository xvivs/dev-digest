import type { Severity } from "@devdigest/shared";

/** Tabs of the PR detail screen; the active one lives in `?tab=`. */
export const PR_TABS = ["overview", "findings", "diff"] as const;
export type PrTab = (typeof PR_TABS)[number];
export const DEFAULT_TAB: PrTab = "overview";
/** Tab a freshly started review switches to. */
export const RUNS_TAB: PrTab = "findings";

/**
 * Values `?severity=` may carry. Deliberately a local literal tuple and NOT
 * `Severity.options` from `@devdigest/shared`: that is a VALUE import of the
 * vendored barrel, whose `.js` re-export specifiers Next's webpack cannot
 * resolve — the whole page would 500 at request time while typecheck and
 * vitest stay green (see client/INSIGHTS.md).
 */
export const SEVERITIES = ["CRITICAL", "WARNING"] as const satisfies readonly Severity[];
