/* PR detail — pure helpers (no React). */
import type { Severity } from "@devdigest/shared";
import { DEFAULT_TAB, PR_TABS, type PrTab } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { SEVERITIES } from "./constants";

/** `?severity=` → a Severity, or null for anything else (see SEVERITIES). */
export function parseSeverity(raw: string | null): Severity | null {
  return (SEVERITIES as readonly string[]).includes(raw ?? "") ? (raw as Severity) : null;
}

/** `?tab=` → a PrTab, falling back to DEFAULT_TAB for anything outside PR_TABS. */
export function parseTab(raw: string | null): PrTab {
  return (PR_TABS as readonly string[]).includes(raw ?? "") ? (raw as PrTab) : DEFAULT_TAB;
}

/** The PR detail URL with one query param set (or removed when `value` is null). */
export function prDetailHref(
  repoId: string,
  number: string,
  current: string,
  key: string,
  value: string | null,
): string {
  const sp = new URLSearchParams(current);
  if (value == null) sp.delete(key);
  else sp.set(key, value);
  const qs = sp.toString();
  return `/repos/${repoId}/pulls/${number}${qs ? `?${qs}` : ""}`;
}
