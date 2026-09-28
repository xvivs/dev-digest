/* pr-status.ts — which PR statuses count as "open" and "needs review".
   Shared by the PR list page and the shell's sidebar badge. Pure, no React. */
import type { PrMeta, PrStatus } from "@devdigest/shared";

/** Open PRs carry a derived review status; everything else is merged/closed. */
export const OPEN_STATUSES: ReadonlySet<PrStatus> = new Set<PrStatus>([
  "needs_review",
  "reviewed",
  "stale",
]);

export function isOpenStatus(status: PrStatus): boolean {
  return OPEN_STATUSES.has(status);
}

type WithStatus = Pick<PrMeta, "status">;

/** Open PRs in the list (needs_review + reviewed + stale). */
export function countOpen(pulls: readonly WithStatus[] | undefined): number {
  return (pulls ?? []).filter((p) => isOpenStatus(p.status)).length;
}

/** PRs whose head has not been reviewed yet — the sidebar badge count. */
export function countNeedsReview(pulls: readonly WithStatus[] | undefined): number {
  return (pulls ?? []).filter((p) => p.status === "needs_review").length;
}
