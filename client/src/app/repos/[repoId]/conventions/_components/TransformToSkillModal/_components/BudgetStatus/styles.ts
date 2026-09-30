import type { CSSProperties } from "react";

/** Co-located styles for BudgetStatus. */
export const s = {
  wrap: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  title: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  line: (over: boolean): CSSProperties => ({ color: over ? "var(--crit)" : "var(--text-secondary)" }),
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
