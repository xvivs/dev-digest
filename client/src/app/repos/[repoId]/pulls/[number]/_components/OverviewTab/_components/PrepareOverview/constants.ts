import type { PrepareAction } from "@devdigest/shared";

/**
 * Actions the client may continue on its own after one click (spec 06 D13a).
 * `clone` is never auto-continued; `reindex_partial` is never in `actions`.
 */
export const AUTO_CONTINUE_ACTIONS: readonly PrepareAction[] = ["derive_brief", "index_full", "index_incremental"];

/**
 * Settings → API Keys. Mirrors `SECTION_API_KEYS` in
 * `app/settings/[section]/_components/SettingsView/constants.ts`; routes do not
 * import each other's internals.
 */
export const SETTINGS_API_KEYS_HREF = "/settings/api-keys";

/** How often the "last indexed X ago" tooltip re-ages. */
export const TOOLTIP_TICK_MS = 60_000;

/** Characters of a sha shown in the tooltip. */
export const SHA_SHORT_LEN = 7;
