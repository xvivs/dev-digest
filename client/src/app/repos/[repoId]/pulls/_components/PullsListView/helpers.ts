/** Pure list logic for the PR list view: filter by status + query, then sort. */
import type { PrMeta } from "@devdigest/shared";
import { STATUS_ALL } from "../../constants";
import type { SortOrder } from "../../helpers";

export interface PullsFilter {
  /** A PR status, or `STATUS_ALL` for no status filter. Raw from `?status=`. */
  status: string;
  /** Free-text query; matches the title (case-insensitive) or the PR number. */
  query: string;
  sort: SortOrder;
}

type ListedPr = Pick<PrMeta, "status" | "title" | "number" | "updated_at">;

/** Epoch ms of `updated_at`; a missing or unparseable date sorts as the epoch. */
function updatedAtMs(p: ListedPr): number {
  return Date.parse(p.updated_at ?? "") || 0;
}

/**
 * The rows the table shows. Never mutates `pulls`; ties keep API order
 * (`Array.prototype.sort` is stable).
 */
export function filterAndSortPulls<T extends ListedPr>(
  pulls: readonly T[] | undefined,
  { status, query, sort }: PullsFilter,
): T[] {
  const q = query.trim().toLowerCase();
  return (pulls ?? [])
    .filter((p) => status === STATUS_ALL || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
    .sort((a, b) => (sort === "oldest" ? updatedAtMs(a) - updatedAtMs(b) : updatedAtMs(b) - updatedAtMs(a)));
}
