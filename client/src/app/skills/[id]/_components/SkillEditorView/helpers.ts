import { DEFAULT_EDITOR_TAB } from "@/app/skills/constants";
import { SKILL_EDITOR_TABS } from "../../constants";

/** `?tab=` → a known editor tab key; anything else (missing, stale, typo) → the default tab. */
export function resolveTab(raw: string | null): string {
  return raw != null && SKILL_EDITOR_TABS.some((tb) => tb.key === raw) ? raw : DEFAULT_EDITOR_TAB;
}

/** The current query string with `tab` set, keeping every other param. */
export function withTab(search: string, tab: string): string {
  const sp = new URLSearchParams(search);
  sp.set("tab", tab);
  return sp.toString();
}
