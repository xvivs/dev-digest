import type { CSSProperties } from "react";

/** Co-located styles for InvisibleCharSegments. */
export const s = {
  invisibleMark: {
    background: "var(--warn-bg)",
    color: "var(--warn)",
    borderRadius: 3,
    padding: "0 2px",
  } satisfies CSSProperties,
} as const;
