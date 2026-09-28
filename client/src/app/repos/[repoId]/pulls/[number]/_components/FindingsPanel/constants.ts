import type { FindingActionKind } from "@devdigest/shared";

/** Confidence below this is hidden when "hide low confidence" is on. */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** Keyboard shortcut → finding action. Indexed by an arbitrary `KeyboardEvent.key`,
 *  so a read is `FindingActionKind | undefined` under noUncheckedIndexedAccess. */
export const KEY_TO_ACTION: Partial<Record<string, FindingActionKind>> = {
  a: "accept",
  d: "dismiss",
};
