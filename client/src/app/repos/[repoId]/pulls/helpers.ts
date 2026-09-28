import type { PrMeta } from "@devdigest/shared";
import { SIZE_COLOR, SIZE_MEDIUM_MAX, SIZE_SMALL_MAX, SORT_ORDERS } from "./constants";

/** S/M/L size bucket; the keys of `SIZE_COLOR`. */
export type PrSize = keyof typeof SIZE_COLOR;
export type SizeInfo = { size: PrSize; lines: number };

/** A FilterBar sort order. */
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Narrow a raw select value to a known sort order. */
export function isSortOrder(raw: string): raw is SortOrder {
  return (SORT_ORDERS as readonly string[]).includes(raw);
}

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: Pick<PrMeta, "additions" | "deletions">): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size: PrSize = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

/**
 * A compact "time since" token for the list's UPDATED column. The view formats
 * it through next-intl (`list.relative.<unit>`); this helper produces no copy.
 * `value` is 0 for `now`.
 */
export type RelativeTime = { unit: "now" | "minute" | "hour" | "day"; value: number };

/** Time since `iso`, rounded to the largest whole unit; `null` for a missing or unparseable date. */
export function relativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): RelativeTime | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const m = Math.max(0, Math.round((now - then) / 60_000));
  if (m < 1) return { unit: "now", value: 0 };
  if (m < 60) return { unit: "minute", value: m };
  const h = Math.round(m / 60);
  if (h < 24) return { unit: "hour", value: h };
  return { unit: "day", value: Math.round(h / 24) };
}
