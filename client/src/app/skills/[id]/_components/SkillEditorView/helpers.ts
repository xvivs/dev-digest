import { DEFAULT_EDITOR_TAB } from "@/app/skills/constants";
import { resolveTab as resolveTabGeneric, withTab } from "@/lib/tabs";
import { SKILL_EDITOR_TABS } from "../../constants";
import { SkillStatsWindow } from "@devdigest/shared/contracts/skill-impact";
import { FROM_VERSION_PARAM, STATS_WINDOW_PARAM } from "./constants";

const TAB_KEYS = SKILL_EDITOR_TABS.map((tb) => tb.key);
const POSITIVE_INT = /^[1-9]\d*$/;

/** `?tab=` → a known editor tab key; anything else (missing, stale, typo) → the default tab. */
export function resolveTab(raw: string | null): string {
  return resolveTabGeneric(raw, TAB_KEYS, DEFAULT_EDITOR_TAB);
}

/** `?fromVersion=` → a version number, or null for anything that is not a positive integer. */
export function parseFromVersion(raw: string | null): number | null {
  return raw != null && POSITIVE_INT.test(raw) ? Number(raw) : null;
}

/**
 * The query string for `tab`, keeping unrelated params. `fromVersion` is set
 * only when given: every other navigation drops it, so the draft seed is
 * consumed once and a later visit to Config opens the saved skill.
 */
export function editorQuery(search: string, tab: string, fromVersion: number | null = null): string {
  const sp = new URLSearchParams(withTab(search, tab));
  if (fromVersion == null) sp.delete(FROM_VERSION_PARAM);
  else sp.set(FROM_VERSION_PARAM, String(fromVersion));
  return sp.toString();
}

/** The server's default window (`SkillStatsQuery`), used for a missing or unknown `?window=`. */
const DEFAULT_STATS_WINDOW: SkillStatsWindow = "30d";

/** `?window=` → a Stats window; anything outside the enum → 30d, as the server defaults. */
export function parseStatsWindow(raw: string | null): SkillStatsWindow {
  const parsed = SkillStatsWindow.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_STATS_WINDOW;
}

/** The query string with `window` set, keeping `tab` and every other param. */
export function statsWindowQuery(search: string, window: SkillStatsWindow): string {
  const sp = new URLSearchParams(search);
  sp.set(STATS_WINDOW_PARAM, window);
  return sp.toString();
}

export { withTab };
