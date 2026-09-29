/** Index states the extractor can read from (server AC-3: `full` or `partial`). */
export const INDEXED_STATUSES: readonly string[] = ["full", "partial"];
/** Server codes for "the repo cannot be scanned yet" (AC-3). */
export const REPO_BLOCKED_CODES: readonly string[] = ["repo_not_indexed", "repo_not_cloned"];
export const CONFLICT_STATUS = 409;
/** Server code (and index-state reason) for "no local clone", where a resync cannot help. */
export const NOT_CLONED_CODE = "repo_not_cloned";
/** Placeholder cards while a scan runs. */
export const SKELETON_CARDS = 3;
export const SKELETON_CARD_HEIGHT = 150;
/** `POST …/conventions/skills` accepts 1..50 ids (AC-6). */
export const MAX_SELECTED = 50;
/** Extract failures are shown inline, so the global toast stays silent (ADR 0011). */
export const LOCAL_ERRORS = { meta: { errorSurface: "local" } } as const;
