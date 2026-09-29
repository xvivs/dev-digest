import type { EvalCarrier, EvalSuite } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { RUN_ERROR_CODES, type RunErrorCode } from "./constants";

/**
 * The carrier to preselect: the server's `is_default` (skill-impact decision 5:
 * most completed runs among enabled-link agents). Falls back to the first
 * carrier defensively, null when the skill has no eligible carrier.
 */
export function preselectedCarrierId(carriers: readonly EvalCarrier[] | undefined): string | null {
  return carriers?.find((c) => c.is_default)?.agent_id ?? carriers?.[0]?.agent_id ?? null;
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
