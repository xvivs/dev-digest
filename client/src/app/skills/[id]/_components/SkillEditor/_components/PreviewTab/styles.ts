import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  title: {
    fontSize: 15,
    fontWeight: 650,
    color: "var(--text-primary)",
    margin: "0 0 4px",
  } satisfies CSSProperties,
} as const;
