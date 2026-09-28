import { DEFAULT_EDITOR_TAB } from "@/app/skills/constants";
import { resolveTab as resolveTabGeneric, withTab } from "@/lib/tabs";
import { SKILL_EDITOR_TABS } from "../../constants";

const TAB_KEYS = SKILL_EDITOR_TABS.map((tb) => tb.key);

/** `?tab=` → a known editor tab key; anything else (missing, stale, typo) → the default tab. */
export function resolveTab(raw: string | null): string {
  return resolveTabGeneric(raw, TAB_KEYS, DEFAULT_EDITOR_TAB);
}

export { withTab };
