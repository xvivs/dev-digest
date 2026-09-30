import type { CSSProperties } from "react";

/** Co-located styles for RuleEditor. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  categoryField: { width: 200 } satisfies CSSProperties,
  count: (over: boolean): CSSProperties => ({
    marginLeft: "auto",
    fontSize: 12,
    color: over ? "var(--crit)" : "var(--text-muted)",
  }),
} as const;
