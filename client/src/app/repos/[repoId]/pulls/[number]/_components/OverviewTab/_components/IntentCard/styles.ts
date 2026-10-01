import type { CSSProperties } from "react";

export const s = {
  confidenceBadge: { padding: "1px 6px", fontSize: 11 } satisfies CSSProperties,
  quote: {
    margin: "0 0 16px",
    padding: 0,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 1.55,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  scopes: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 16 } satisfies CSSProperties,
  scope: { minWidth: 0 } satisfies CSSProperties,
  scopeHead: (out: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: out ? "var(--text-muted)" : "var(--ok, var(--info))",
    marginBottom: 8,
  }),
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  item: (out: boolean): CSSProperties => ({
    display: "flex",
    gap: 6,
    fontSize: 12.5,
    color: out ? "var(--text-muted)" : "var(--text-secondary)",
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  }),
  bullet: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
