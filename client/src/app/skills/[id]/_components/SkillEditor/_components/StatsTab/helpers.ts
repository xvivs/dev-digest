import type { CostMissingReason, SkillAgentUsage, SkillVersionStats } from "@devdigest/shared";
import { AGENTS_HREF, AGENT_SKILLS_TAB } from "./constants";

/** An agent's editor on its Skills tab, where the link to this skill is toggled. */
export function agentSkillsHref(agentId: string): string {
  return `${AGENTS_HREF}/${encodeURIComponent(agentId)}?tab=${AGENT_SKILLS_TAB}`;
}

/** Busiest agents first; ties by name so the order is stable between refetches. */
export function sortAgentsByRuns(agents: readonly SkillAgentUsage[]): SkillAgentUsage[] {
  return [...agents].sort((a, b) => b.runs - a.runs || a.agent_name.localeCompare(b.agent_name));
}

/** Newest version first, matching the Versions tab. */
export function sortVersionsDesc(rows: readonly SkillVersionStats[]): SkillVersionStats[] {
  return [...rows].sort((a, b) => b.version - a.version);
}

/**
 * Why a cost is missing, for RunCostValue's tooltip. With tokens recorded the
 * only reason is an unpriced model; with nothing recorded there is no cost to
 * explain, so the generic "unavailable" text applies.
 */
export function costMissingReason(cost_usd: number | null, tokens: number): CostMissingReason | null {
  if (cost_usd != null) return null;
  return tokens > 0 ? "no_price" : null;
}

/** `passing / total` as a whole percent for CircularScore; 0 when there are no cases. */
export function passRatePercent(passing: number, total: number): number {
  return total > 0 ? Math.round((passing / total) * 100) : 0;
}

/** Signed one-decimal delta: "+0.4", "−1.2" (U+2212), "0.0". */
export function formatSignedDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const abs = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${abs}`;
  if (rounded < 0) return `−${abs}`;
  return abs;
}
