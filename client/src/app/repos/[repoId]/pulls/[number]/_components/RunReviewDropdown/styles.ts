import type { CSSProperties } from "react";

/** Co-located styles for RunReviewDropdown. */
export const s = {
  /** Merged/closed PR: the trigger stays usable but reads as secondary. */
  dimmedTrigger: { opacity: 0.6 } satisfies CSSProperties,
} as const;
