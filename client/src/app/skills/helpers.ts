import { DEFAULT_EDITOR_TAB, SKILLS_HREF } from "./constants";

/** URL of a skill's editor, opened on `tab`. */
export function skillEditorHref(id: string, tab: string = DEFAULT_EDITOR_TAB): string {
  return `${SKILLS_HREF}/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`;
}
