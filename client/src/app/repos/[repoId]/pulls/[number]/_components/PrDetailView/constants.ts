import type { Severity } from "@devdigest/shared";

/**
 * Values `?severity=` may carry. Deliberately a local literal tuple and NOT
 * `Severity.options` from `@devdigest/shared`: that is a VALUE import of the
 * vendored barrel, whose `.js` re-export specifiers Next's webpack cannot
 * resolve — the whole page would 500 at request time while typecheck and
 * vitest stay green (see client/INSIGHTS.md).
 */
export const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const satisfies readonly Severity[];
