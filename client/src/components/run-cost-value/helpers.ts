/**
 * Cost formatting — adaptive precision, shared by every surface that renders a
 * run's cost (timeline, sidebar stats, PR list column). Kept separate from
 * RunCostValue.tsx on purpose: once aggregated sums (cost_by_agent /
 * cost_by_model) land in a later lesson, the formatter moves to a shared
 * location while RunCostValue stays single-run-only.
 */

/**
 * Adaptive-precision USD display: more decimals for very small amounts (LLM
 * runs are often fractions of a cent), fewer as the amount grows.
 *
 * Zero is a KNOWN cost ("$0.0000") — a free model, not an unknown one — so it
 * must never collapse to the missing-value dash.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.0000";
  const abs = Math.abs(usd);
  const decimals = abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  return `$${usd.toFixed(decimals)}`;
}

/**
 * Full, unrounded value for the tooltip — never truncated by formatCost's
 * adaptive precision.
 *
 * Not `toString()`: JS switches to exponential notation below 1e-6, so a very
 * cheap run would render its tooltip as "$1e-7".
 */
export function exactCost(usd: number): string {
  const digits = usd.toLocaleString("en-US", {
    maximumFractionDigits: 20,
    useGrouping: false,
  });
  return `$${digits}`;
}
