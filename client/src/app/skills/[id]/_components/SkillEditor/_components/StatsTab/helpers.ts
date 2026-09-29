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
