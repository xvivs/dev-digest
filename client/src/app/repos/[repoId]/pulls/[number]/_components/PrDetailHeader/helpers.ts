import type { PrDetail } from "@/lib/types";

/** A merged or closed PR: reviewing it is informational only. */
export function isSettledPr(status: PrDetail["status"]): boolean {
  return status === "merged" || status === "closed";
}
