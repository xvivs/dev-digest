import type { CSSProperties } from "react";

export const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  item: { minWidth: 0 } satisfies CSSProperties,
  symbol: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  callers: {
    listStyle: "none",
    margin: "6px 0 0",
    padding: "0 0 0 14px",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
} as const;
