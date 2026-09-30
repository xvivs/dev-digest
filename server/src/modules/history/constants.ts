/** Prior-PR history limits (ADR 0023). */
/** Changed files queried per cache miss, highest churn first. */
export const HISTORY_MAX_PATHS = 10;
/** Commits inspected per path. */
export const HISTORY_PER_PATH = 10;
/** Items returned. */
export const HISTORY_MAX_ITEMS = 10;
/** A cached result is fresh for this long when the key still matches. */
export const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
