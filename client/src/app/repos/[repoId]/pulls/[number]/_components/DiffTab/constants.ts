import type { SmartDiffRole } from "@devdigest/shared";

/** Labels live in `prReview.smartDiff`; `color` is the group square (tokens only). Lookup, not an order. */
export const ROLE_META: Record<SmartDiffRole, { labelKey: string; descKey: string; color: string }> = {
  core: { labelKey: "smartDiff.coreLabel", descKey: "smartDiff.coreDescription", color: "var(--accent)" },
  tests: { labelKey: "smartDiff.testsLabel", descKey: "smartDiff.testsDescription", color: "var(--ok)" },
  wiring: { labelKey: "smartDiff.wiringLabel", descKey: "smartDiff.wiringDescription", color: "var(--warn)" },
  docs: { labelKey: "smartDiff.docsLabel", descKey: "smartDiff.docsDescription", color: "var(--text-secondary)" },
  boilerplate: {
    labelKey: "smartDiff.boilerplateLabel",
    descKey: "smartDiff.boilerplateDescription",
    color: "var(--text-muted)",
  },
};

/** Groups and file cards in these roles start collapsed. */
export const COLLAPSED_ROLES: ReadonlySet<SmartDiffRole> = new Set<SmartDiffRole>(["docs", "boilerplate"]);

/** Role of a file the smart-diff response does not list. */
export const FALLBACK_ROLE: SmartDiffRole = "core";

export const ORDER_MODES = ["smart", "original"] as const;
export type OrderMode = (typeof ORDER_MODES)[number];

/** `prReview` message key of each order mode's button label. */
export const ORDER_LABEL_KEY: Record<OrderMode, string> = {
  smart: "smartDiff.smartOrder",
  original: "smartDiff.originalOrder",
};
