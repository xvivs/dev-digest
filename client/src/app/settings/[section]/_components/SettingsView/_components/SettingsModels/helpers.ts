import type { Settings } from "@/lib/types";

/** Effective value of the automatic-brief toggle: on unless explicitly `false` (matches the server's `value !== false`). */
export function isAutoBriefOn(settings: Pick<Settings, "automatic_brief"> | null | undefined): boolean {
  return settings?.automatic_brief !== false;
}
