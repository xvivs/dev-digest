/** Constants for the PR list page (/repos/:repoId/pulls). */

/** Fallback for a status STATUS_META does not know (the list's default filter). */
export const DEFAULT_STATUS_META: { c: string; labelKey: string } = {
  c: "var(--warn)",
  labelKey: "needs_review",
};

/**
 * Review status → colour token + i18n label key (under `list.status`). Open PRs
 * carry a derived review status (needs_review / reviewed / stale); merged/closed
 * keep their GitHub merge state.
 */
export const STATUS_META: Record<string, { c: string; labelKey: string }> = {
  needs_review: DEFAULT_STATUS_META,
  reviewed: { c: "var(--ok)", labelKey: "reviewed" },
  stale: { c: "var(--stale)", labelKey: "stale" },
  open: { c: "var(--warn)", labelKey: "open" },
  merged: { c: "var(--ok)", labelKey: "merged" },
  closed: { c: "var(--stale)", labelKey: "closed" },
};

/** Size bucket → colour token. Its keys ARE the size buckets (`PrSize` in helpers.ts). */
export const SIZE_COLOR = {
  S: "var(--ok)",
  M: "var(--warn)",
  L: "var(--crit)",
} as const satisfies Record<string, string>;

/** Grid template for both the header row and PR rows. */
export const GRID = "1fr 132px 92px 60px 104px 118px 80px 78px";

/** Line-count thresholds for the S/M/L size bucket. */
export const SIZE_SMALL_MAX = 100;
export const SIZE_MEDIUM_MAX = 400;

/** Filter chips: status key + i18n label key (under `list.filter`). */
export const STATUS_FILTERS: { key: string; labelKey: string }[] = [
  { key: "all", labelKey: "all" },
  { key: "needs_review", labelKey: "needs_review" },
  { key: "reviewed", labelKey: "reviewed" },
  { key: "stale", labelKey: "stale" },
];

/** URL `?status=` value that disables the status filter. */
export const STATUS_ALL = "all";

/** Status filter applied when `?status=` is absent — the most actionable view on open. */
export const DEFAULT_STATUS_FILTER = "needs_review";

/** Sort orders offered by the FilterBar select (i18n label under `list.sort`). */
export const SORT_ORDERS = ["newest", "oldest"] as const;

/** Sort applied on first render. */
export const DEFAULT_SORT: (typeof SORT_ORDERS)[number] = "newest";

/** Width of the FilterBar search box, in px. */
export const SEARCH_BOX_WIDTH = 240;

/** Column header i18n keys (under `list.columns`), in display order. */
export const COLUMN_KEYS: string[] = [
  "pullRequest",
  "author",
  "size",
  "score",
  "findings",
  "status",
  "cost",
  "updated",
];

/** Numeric/temporal columns whose header (and cell) align right. */
export const RIGHT_ALIGNED_COLUMNS = new Set<string>(["cost", "updated"]);

/** Number of skeleton rows shown while loading. */
export const SKELETON_ROWS = 4;

/** Height of one loading skeleton row, in px (≈ one PR row's content height). */
export const SKELETON_ROW_HEIGHT = 28;
