import { ApiError } from "@/lib/api";
import { VERSION_STALE_CODE } from "./constants";

/** A restore refused because someone saved the skill after this screen loaded it. */
export function isVersionStale(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === VERSION_STALE_CODE;
}

/** `imported` and `extracted` skills reset vetting on a body change (ADR 0016 decision 7,
 *  ADR 0019; mirrors server `resolveVettingOnBodyEdit`). */
export function restoreResetsVetting(source: string): boolean {
  return source === "imported" || source === "extracted";
}
