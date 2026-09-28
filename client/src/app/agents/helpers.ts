import { AGENTS_HREF, DEFAULT_EDITOR_TAB } from "./constants";

/** URL of an agent's editor, opened on `tab`. */
export function agentEditorHref(id: string, tab: string = DEFAULT_EDITOR_TAB): string {
  return `${AGENTS_HREF}/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`;
}
