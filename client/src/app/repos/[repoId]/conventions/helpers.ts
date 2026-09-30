/* Pure logic for the Conventions route, shared by its sibling components
   (view, card). No React, no API calls — every rule here is unit-tested.
   Skill-body and budget rules live with their only consumer, TransformToSkillModal/helpers.ts. */
import type { ConventionCandidate } from "@devdigest/shared";
import {
  CONFIDENCE_HIGH_PCT,
  CONFIDENCE_MEDIUM_PCT,
  KNOWN_ERROR_CODES,
  RULE_MAX_LENGTH,
  RULE_MIN_LENGTH,
  type ConfidenceTone,
  type KnownErrorCode,
  type TabKey,
} from "./constants";

// ---- tabs ----

/** All = pending + accepted; Accepted; Rejected (D8). */
export function filterByTab(candidates: readonly ConventionCandidate[], tab: TabKey): ConventionCandidate[] {
  if (tab === "all") return candidates.filter((c) => c.status !== "rejected");
  return candidates.filter((c) => c.status === tab);
}

/** The count on each tab, tallied from the one candidates array so the tabs and the list never disagree. */
export function tabCounts(candidates: readonly ConventionCandidate[]): Record<TabKey, number> {
  return {
    all: filterByTab(candidates, "all").length,
    accepted: filterByTab(candidates, "accepted").length,
    rejected: filterByTab(candidates, "rejected").length,
  };
}

// ---- confidence ----

/** Whole-percent label of a 0..1 confidence. */
export function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

/** Tone from the rounded percentage, so "80%" is never painted amber (D16). */
export function confidenceTone(confidence: number): ConfidenceTone {
  const pct = confidencePct(confidence);
  if (pct >= CONFIDENCE_HIGH_PCT) return "high";
  if (pct >= CONFIDENCE_MEDIUM_PCT) return "medium";
  return "low";
}

// ---- selection (AC-39) ----

/** Ids of the accepted candidates, in list order. */
export function acceptedIds(candidates: readonly ConventionCandidate[]): string[] {
  return candidates.filter((c) => c.status === "accepted").map((c) => c.id);
}

/**
 * The selection that counts is the stored selection intersected with what is
 * accepted right now: rejecting a selected card, or a rescan that drops it,
 * silently removes it instead of leaving a phantom id in the payload.
 */
export function effectiveSelection(selected: ReadonlySet<string>, accepted: readonly string[]): string[] {
  return accepted.filter((id) => selected.has(id));
}

// ---- rule editing (AC-37) ----

/** Whether an edited rule satisfies the server's bounds (8..300 after trimming). */
export function isRuleValid(rule: string): boolean {
  const n = rule.trim().length;
  return n >= RULE_MIN_LENGTH && n <= RULE_MAX_LENGTH;
}

// ---- scan errors ----

/**
 * The known code at the start of a raw scan error (`code: detail`, or the bare
 * code), else null. Anything unrecognised gets the generic message.
 */
export function knownErrorCode(raw: string | null | undefined): KnownErrorCode | null {
  if (!raw) return null;
  const head = raw.split(":", 1)[0]?.trim() ?? "";
  return KNOWN_ERROR_CODES.find((c) => c === head) ?? null;
}
