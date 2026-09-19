import type { CostSource } from '@devdigest/shared';

/**
 * Chooses which cost figure to trust and tags it with its provenance.
 *
 * A provider-reported charge always outranks a local estimate — it's the
 * actual bill, not a guess. When neither is available the caller has no
 * number to show; both fields come back null together (never a lone
 * `costUsd` without a `costSource`, and vice versa) so `null` never has to
 * be interpreted twice.
 */
export function pickCost(
  apiCost: number | null,
  estimated: number | null,
): { costUsd: number | null; costSource: CostSource | null } {
  if (apiCost != null) return { costUsd: apiCost, costSource: 'provider' };
  if (estimated != null) return { costUsd: estimated, costSource: 'estimated' };
  return { costUsd: null, costSource: null };
}
