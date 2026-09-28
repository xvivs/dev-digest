/* tabs.ts — generic `?tab=` validation + query-string helpers shared by every
   editor screen with a tab bar (Skill editor, Agent editor, …). */

/** `raw` → a known member of `tabs`, or `fallback` for anything else (missing,
 *  stale, typo). */
export function resolveTab<T extends string>(raw: string | null, tabs: readonly T[], fallback: T): T {
  return raw != null && tabs.includes(raw as T) ? (raw as T) : fallback;
}

/** The current query string with `tab` set, keeping every other param. */
export function withTab(search: string, tab: string): string {
  const sp = new URLSearchParams(search);
  sp.set("tab", tab);
  return sp.toString();
}
