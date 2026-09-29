import { DEFAULT_EDITOR_TAB } from "@/app/skills/constants";
import { resolveTab as resolveTabGeneric, withTab } from "@/lib/tabs";
import { SKILL_EDITOR_TABS } from "../../constants";
import { SkillStatsWindow } from "@devdigest/shared/contracts/skill-impact";
import { CASE_PARAM, STATS_WINDOW_PARAM, SUITE_PARAM } from "./constants";

const TAB_KEYS = SKILL_EDITOR_TABS.map((tb) => tb.key);
const ID_PARAM = /^[\w-]{1,64}$/;

/** `?tab=` → a known editor tab key; anything else (missing, stale, typo) → the default tab. */
export function resolveTab(raw: string | null): string {
  return resolveTabGeneric(raw, TAB_KEYS, DEFAULT_EDITOR_TAB);
}

/** The query string for `tab`, keeping unrelated params. */
export function editorQuery(search: string, tab: string): string {
  const sp = new URLSearchParams(withTab(search, tab));
  // The drawer belongs to the Evals tab: leaving it closes it.
  sp.delete(CASE_PARAM);
  sp.delete(SUITE_PARAM);
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

/** `?case=` / `?suite=` → an id, or null for anything that is not id-shaped (the API validates the rest). */
export function parseCaseParam(raw: string | null): string | null {
  return raw != null && ID_PARAM.test(raw) ? raw : null;
}

/** The query string with the drawer's `case` (and `suite`) set or, for a null case, removed. Keeps every other param. */
export function caseQuery(search: string, caseId: string | null, suiteId: string | null): string {
  const sp = new URLSearchParams(search);
  sp.delete(CASE_PARAM);
  sp.delete(SUITE_PARAM);
  if (caseId) {
    sp.set(CASE_PARAM, caseId);
    if (suiteId) sp.set(SUITE_PARAM, suiteId);
  }
  return sp.toString();
}

export { withTab };
