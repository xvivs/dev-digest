import type { Provider } from "@devdigest/shared";

/** Selectable providers — shared by the create modal (/agents) and the Config tab (/agents/:id). */
export const PROVIDER_OPTIONS: readonly Provider[] = ["openai", "anthropic", "openrouter"];

/** The agents list route. */
export const AGENTS_HREF = "/agents";

/** Editor tab a link opens when it does not name one (and the fallback for an unknown `?tab=`). */
export const DEFAULT_EDITOR_TAB = "config";
