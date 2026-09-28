import type { CSSProperties } from "react";

/** Co-located styles for SeverityFilterBar. */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 7,
  } satisfies CSSProperties,
  counts: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  separator: {
    color: "var(--text-muted)",
    fontWeight: 400,
  } satisfies CSSProperties,
  filters: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  count: (color: string): CSSProperties => ({ color }),
} as const;
