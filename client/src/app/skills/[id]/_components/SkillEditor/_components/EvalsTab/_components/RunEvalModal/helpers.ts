import type { Agent, EvalSuite, SkillAgentUsage } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { RUN_ERROR_CODES, type RunErrorCode } from "./constants";

/**
 * Default carrier (skill-impact decision 5): the agent that ran this skill the
 * most in the Stats window. Falls back to the first agent when none has runs,
 * and to null when there are no agents at all. Only agents that still exist
 * are eligible.
 */
export function defaultCarrierId(agents: readonly Agent[], usage: readonly SkillAgentUsage[] | undefined): string | null {
  const exists = new Set(agents.map((a) => a.id));
  const busiest = [...(usage ?? [])]
    .filter((u) => u.runs > 0 && exists.has(u.agent_id))
    .sort((a, b) => b.runs - a.runs || a.agent_name.localeCompare(b.agent_name))[0];
  return busiest?.agent_id ?? agents[0]?.id ?? null;
}

/** Cases behind an estimate: `total_jobs = cases × 2 arms × repeats`. */
export function estimateCaseCount(suite: Pick<EvalSuite, "total_jobs" | "repeats">): number {
  return suite.repeats > 0 ? Math.round(suite.total_jobs / (2 * suite.repeats)) : 0;
}

/** A known eval error code for its own message, or null for the generic one. */
export function runErrorCode(error: unknown): RunErrorCode | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  return (RUN_ERROR_CODES as readonly string[]).includes(error.code) ? (error.code as RunErrorCode) : null;
}
