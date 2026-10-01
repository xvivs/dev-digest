/* Pure rules of the Prepare overview button (spec 06 D11-D13a). No React. */
import type { CloneFailureReason, PartialReason, PrepareAction, PrepareOverviewRequest, PrOverviewReadiness } from "@devdigest/shared";
import { AUTO_CONTINUE_ACTIONS, SHA_SHORT_LEN } from "./constants";

export type PrepareLabel = "label" | "preparing" | "updateIndex" | "blocked" | "ready";

export interface PrepareButtonState {
  label: PrepareLabel;
  enabled: boolean;
  busy: boolean;
  /** What a click sends; `null` = not clickable. */
  click: "prepare" | "updateIndex" | null;
}

/** The body each click kind sends. */
export const CLICK_BODY: Record<"prepare" | "updateIndex", PrepareOverviewRequest> = {
  prepare: {},
  updateIndex: { reindex_partial: true },
};

/** D11 table, first match wins. `undefined` = loading or error. */
export function prepareButtonState(r: PrOverviewReadiness | undefined): PrepareButtonState {
  if (!r) return { label: "label", enabled: false, busy: false, click: null };
  if (r.in_flight) return { label: "preparing", enabled: false, busy: true, click: null };
  if (r.actions.length > 0) return { label: "label", enabled: true, busy: false, click: "prepare" };
  if (r.explicit_actions.includes("reindex_partial")) {
    return { label: "updateIndex", enabled: true, busy: false, click: "updateIndex" };
  }
  if (r.blocked_by !== null) return { label: "blocked", enabled: false, busy: false, click: null };
  return { label: "ready", enabled: false, busy: false, click: null };
}

export const sha7 = (sha: string): string => sha.slice(0, SHA_SHORT_LEN);

export type IndexTooltip =
  | { key: "flagOff" }
  | { key: "never" }
  | { key: "partial"; reason: PartialReason | "unknown"; time: string | null }
  | { key: "lastIndexed"; time: string; sha: string }
  | { key: "notRecorded"; sha: string };

export interface RelativeTimeFormat {
  relativeTime(date: Date, now: Date): string;
}

/** D12 table. `now` is explicit so render stays pure. */
export function indexTooltip(r: PrOverviewReadiness, now: Date, format: RelativeTimeFormat): IndexTooltip {
  const { status, last_indexed_at: at, last_indexed_sha: sha, partial_reason: reason } = r.index;
  if (status === "flag_off") return { key: "flagOff" };
  const time = at ? format.relativeTime(new Date(at), now) : null;
  if (status === "partial" && sha) return { key: "partial", reason: reason ?? "unknown", time };
  if (!sha) return { key: "never" };
  if (time) return { key: "lastIndexed", time, sha: sha7(sha) };
  return { key: "notRecorded", sha: sha7(sha) };
}

/**
 * Why the last clone failed, while Prepare would try it again. `null` = nothing
 * to explain (no failure, or the clone is running or not in the plan).
 */
export function cloneFailureReason(r: PrOverviewReadiness | undefined): CloneFailureReason | null {
  if (!r || !r.actions.includes("clone")) return null;
  return r.clone.last_failure?.reason ?? null;
}

/** One click's auto-continuation state, scoped to one PR (D13a). */
export interface ContinuationIntent {
  prId: string;
  /** Actions already requested under this intent (by the click or an auto POST). */
  fired: Set<PrepareAction>;
}

/** The auto-continuable members of a plan. */
export function autoActionsIn(actions: readonly PrepareAction[]): PrepareAction[] {
  return actions.filter((a) => AUTO_CONTINUE_ACTIONS.includes(a));
}

/** Whether a polled readiness should trigger one more automatic POST. */
export function nextContinuation(
  intent: ContinuationIntent | null,
  r: PrOverviewReadiness,
): { call: false } | { call: true; action: PrepareAction } {
  if (!intent) return { call: false };
  const action = autoActionsIn(r.actions).find((a) => !intent.fired.has(a));
  return action ? { call: true, action } : { call: false };
}

/** Nothing left to do and nothing running: the intent is finished. */
export function isPrepareDone(r: PrOverviewReadiness): boolean {
  return r.actions.length === 0 && !r.in_flight;
}
